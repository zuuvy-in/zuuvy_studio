/**
 * Site tables: where a site's forms put what visitors send — contact
 * enquiries, bookings, sign-ups, quote requests. The AI creates a table with
 * the form that fills it; the owner reads, exports and prunes the rows.
 *
 * Tables are live data, versions are drafts, so the AI's table changes are
 * applied when its version is saved (never during a run that might fail),
 * and it can never delete a table by itself: a deletion is held for the
 * owner, like an overwrite of their data, because rows are people's messages.
 *
 * A submission is checked against the form as published — its fields, types
 * and required answers — not against anything the browser claims.
 */
import { type Section, type SiteTree } from "@zsite/core";
import { type Tx, UserError, isUuid, withTenant } from "./db";
import { getAlerts, queueEmail } from "./email";
import { type ResolvedSite, loadPublished } from "./storefront";

export type ColumnType = "text" | "email" | "tel" | "number" | "textarea" | "select" | "checkbox" | "date";
export type TableColumn = { key: string; label: string; type: ColumnType };
export type SiteTable = {
  id: string;
  site_id: string;
  key: string;
  name: string;
  columns: TableColumn[];
  notify: boolean;
  created_at: Date;
  updated_at: Date;
  rows?: number;
};
export type TableRow = { id: number; data: Record<string, string | boolean | number>; page: string | null; created_at: Date };

/** What the AI decided about tables in one edit; applied with the version. */
export type TableOp =
  | { op: "create"; key: string; name: string; columns: TableColumn[]; notify?: boolean }
  | { op: "update"; key: string; name?: string; columns?: TableColumn[]; notify?: boolean };

const COLUMNS = "id, site_id, key, name, columns, notify, created_at, updated_at";
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const TYPES: ColumnType[] = ["text", "email", "tel", "number", "textarea", "select", "checkbox", "date"];

export function cleanColumns(columns: TableColumn[]): TableColumn[] {
  if (!columns.length) throw new UserError("A table needs at least one column.");
  if (columns.length > 30) throw new UserError("A table can have at most 30 columns.");
  const seen = new Set<string>();
  return columns.map((c) => {
    if (!KEY.test(c.key)) throw new UserError(`"${c.key}" is not a column key: lowercase letters, digits and _.`);
    if (seen.has(c.key)) throw new UserError(`The column ${c.key} is listed twice.`);
    seen.add(c.key);
    if (!TYPES.includes(c.type)) throw new UserError(`${c.key}: type must be one of ${TYPES.join(", ")}.`);
    return { key: c.key, label: (c.label || c.key).trim().slice(0, 80), type: c.type };
  });
}

export async function listSiteTables(tx: Tx, siteId: string): Promise<SiteTable[]> {
  return tx.query<SiteTable>(
    `select ${COLUMNS.split(", ").map((c) => `t.${c}`).join(", ")}, (select count(*)::int from site_table_rows r where r.table_id = t.id) as rows
       from site_tables t where t.site_id = $1 order by t.name`,
    [siteId],
  );
}

export async function getSiteTable(tx: Tx, siteId: string, tableId: string): Promise<SiteTable> {
  if (!isUuid(tableId)) throw new UserError("That table does not exist.");
  return tx.get<SiteTable>(`select ${COLUMNS} from site_tables where id = $1 and site_id = $2`, [tableId, siteId], "table");
}

/** Apply what the AI decided (creations and changes). Deletions never come through here. */
export async function applyTableOps(tx: Tx, siteId: string, ops: TableOp[]): Promise<void> {
  for (const op of ops) {
    if (!KEY.test(op.key)) throw new UserError(`"${op.key}" is not a table key.`);
    if (op.op === "create") {
      const columns = cleanColumns(op.columns);
      await tx.query(
        `insert into site_tables (tenant_id, site_id, key, name, columns, notify) values (app_tenant(), $1, $2, $3, $4, $5)
         on conflict (site_id, key) do update set name = excluded.name, columns = excluded.columns, notify = excluded.notify, updated_at = now()`,
        [siteId, op.key, op.name.trim().slice(0, 80) || op.key, JSON.stringify(columns), op.notify ?? true],
      );
    } else {
      const now = await tx.one<SiteTable>(`select ${COLUMNS} from site_tables where site_id = $1 and key = $2`, [siteId, op.key]);
      if (!now) continue;
      await tx.query("update site_tables set name = $2, columns = $3, notify = $4, updated_at = now() where id = $1", [
        now.id,
        op.name?.trim().slice(0, 80) || now.name,
        JSON.stringify(op.columns ? cleanColumns(op.columns) : now.columns),
        op.notify ?? now.notify,
      ]);
    }
  }
}

export async function deleteSiteTable(tx: Tx, siteId: string, tableKeyOrId: string): Promise<void> {
  const byId = isUuid(tableKeyOrId);
  await tx.get(`delete from site_tables where site_id = $1 and ${byId ? "id" : "key"} = $2 returning id`, [siteId, tableKeyOrId], "table");
}

export async function setTableNotify(tx: Tx, siteId: string, tableId: string, notify: boolean): Promise<void> {
  await tx.get("update site_tables set notify = $3 where id = $1 and site_id = $2 returning id", [tableId, siteId, notify], "table");
}

export async function listRows(tx: Tx, tableId: string, opts: { limit?: number; before?: number } = {}): Promise<TableRow[]> {
  return tx.query<TableRow>(
    `select id, data, page, created_at from site_table_rows where table_id = $1 ${opts.before ? "and id < $3" : ""}
      order by id desc limit $2`,
    opts.before ? [tableId, Math.min(opts.limit ?? 100, 1000), opts.before] : [tableId, Math.min(opts.limit ?? 100, 1000)],
  );
}

export async function deleteRows(tx: Tx, tableId: string, ids: number[]): Promise<void> {
  if (!ids.length) return;
  await tx.query("delete from site_table_rows where table_id = $1 and id = any($2::bigint[])", [tableId, ids]);
}

/** Every row as CSV, columns in the table's order, for the owner's spreadsheet. */
export function rowsToCsv(table: SiteTable, rows: TableRow[]): string {
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? "" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
    // Quote always; neutralise spreadsheet formulas.
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  const head = ["Received", ...table.columns.map((c) => c.label), "Page"].map(cell).join(",");
  const lines = rows.map((r) =>
    [new Date(r.created_at).toISOString(), ...table.columns.map((c) => r.data[c.key]), r.page ?? ""].map(cell).join(","),
  );
  return [head, ...lines].join("\r\n");
}

// ---------------------------------------------------------------------------
// The Data grid: search, filter, sort, pages; CSV in and out
// ---------------------------------------------------------------------------

export type RowQuery = {
  /** Words anywhere in the row. */
  q?: string;
  /** Column key → text it contains (a select/checkbox column: equals). */
  filters?: Record<string, string>;
  /** A column key, or "received". */
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  perPage?: number;
};

/** One page of a table's rows, and how many match in all. */
export async function queryRows(tx: Tx, table: SiteTable, query: RowQuery = {}): Promise<{ rows: TableRow[]; total: number; page: number; pages: number }> {
  const params: unknown[] = [table.id];
  const where = ["table_id = $1"];
  const q = query.q?.trim();
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(data::text ilike $${params.length} or coalesce(page, '') ilike $${params.length})`);
  }
  for (const [key, raw] of Object.entries(query.filters ?? {})) {
    const col = table.columns.find((c) => c.key === key);
    const value = raw.trim();
    if (!col || !value) continue;
    params.push(key);
    const k = params.length;
    if (col.type === "checkbox") {
      params.push(/^(yes|true|1|on)$/i.test(value));
      where.push(`coalesce((data->>$${k})::boolean, false) = $${params.length}`);
    } else if (col.type === "select") {
      params.push(value);
      where.push(`data->>$${k} = $${params.length}`);
    } else {
      params.push(`%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`data->>$${k} ilike $${params.length}`);
    }
  }
  const perPage = Math.min(Math.max(query.perPage ?? 50, 1), 10_000);
  const count = await tx.get<{ n: number }>(`select count(*)::int as n from site_table_rows where ${where.join(" and ")}`, params);
  const dir = query.dir === "asc" ? "asc" : "desc";
  const sortCol = table.columns.find((c) => c.key === query.sort);
  let order = `created_at ${dir}, id ${dir}`;
  if (sortCol) {
    params.push(sortCol.key);
    const expr = sortCol.type === "number" ? `(case when (data->>$${params.length}) ~ '^-?[0-9.]+$' then (data->>$${params.length})::numeric end)` : `lower(data->>$${params.length})`;
    order = `${expr} ${dir} nulls last, id ${dir}`;
  }
  const pages = Math.max(1, Math.ceil(count.n / perPage));
  const page = Math.min(Math.max(Math.floor(query.page ?? 1), 1), pages);
  const rows = await tx.query<TableRow>(
    `select id, data, page, created_at from site_table_rows where ${where.join(" and ")} order by ${order} limit ${perPage} offset ${(page - 1) * perPage}`,
    params,
  );
  return { rows, total: count.n, page, pages };
}

/** RFC 4180 CSV → rows of cells (quotes, doubled quotes, CR/LF, a BOM). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c !== "")) out.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) out.push(row);
  return out;
}

const MAX_IMPORT = 5000;

/**
 * What an import does with the rows already there.
 *   append  — add every row from the file
 *   replace — empty the table first, then add the file
 *   update  — a row matching one already there overwrites it; the rest are added
 *   skip    — a row matching one already there is left out; the rest are added
 */
export type ImportMode = "append" | "replace" | "update" | "skip";
export const IMPORT_MODES: ImportMode[] = ["append", "replace", "update", "skip"];

export type ImportResult = { added: number; updated: number; duplicates: number; removed: number; skipped: { line: number; reason: string }[] };

/** The column a table is naturally matched on: its email, else its phone, else the whole row. */
export function defaultMatch(table: SiteTable): string[] {
  const col = table.columns.find((c) => c.type === "email") ?? table.columns.find((c) => c.type === "tel");
  return col ? [col.key] : [];
}

/** Two rows are the same when the chosen columns agree (ignoring case and spacing), or, with none chosen, every column does. */
function matchKey(table: SiteTable, data: Record<string, unknown>, on: string[]): string | null {
  const keys = on.length ? on : table.columns.map((c) => c.key);
  const parts = keys.map((k) => (data[k] === undefined || data[k] === null ? "" : String(data[k]).trim().toLowerCase().replace(/\s+/g, " ")));
  // A row missing what it is matched on cannot be anybody's duplicate.
  if (on.length && parts.some((p) => !p)) return null;
  return JSON.stringify(parts);
}

/**
 * Add rows from a spreadsheet. The header row names columns by label or key,
 * in any order; unknown columns are ignored. Each cell is checked like a form
 * answer would be; a row that fails is skipped and reported, not guessed at.
 * Our own export's "Received" and "Page" columns come back as they went out.
 * Nothing is written unless the whole file was read, so a replace never
 * leaves an empty table behind a file it could not use.
 */
export async function importRows(
  tx: Tx,
  table: SiteTable,
  csv: string,
  opts: { mode?: ImportMode; matchOn?: string[] } = {},
): Promise<ImportResult> {
  const mode = opts.mode ?? "append";
  if (!IMPORT_MODES.includes(mode)) throw new UserError("Choose what to do with the rows already there.");
  const matchOn = (opts.matchOn ?? defaultMatch(table)).filter((k) => table.columns.some((c) => c.key === k));
  const lines = parseCsv(csv);
  if (!lines.length) throw new UserError("That file is empty.");
  const header = lines[0]!.map((h) => h.trim().toLowerCase());
  const index = new Map<string, number>();
  table.columns.forEach((c) => {
    const at = header.findIndex((h) => h === c.key || h === c.label.toLowerCase());
    if (at >= 0) index.set(c.key, at);
  });
  if (!index.size) throw new UserError(`None of the file's columns match this table. Use a first row with: ${table.columns.map((c) => c.label).join(", ")}.`);
  const missing = matchOn.filter((k) => !index.has(k));
  if ((mode === "update" || mode === "skip") && missing.length) {
    throw new UserError(`To find duplicates the file needs a ${missing.map((k) => table.columns.find((c) => c.key === k)!.label).join(" and ")} column.`);
  }
  const receivedAt = header.findIndex((h) => h === "received");
  const pageAt = header.findIndex((h) => h === "page");
  const body = lines.slice(1);
  if (body.length > MAX_IMPORT) throw new UserError(`Import up to ${MAX_IMPORT} rows at a time.`);
  const skipped: { line: number; reason: string }[] = [];
  const good: { data: Record<string, string | boolean | number>; page: string | null; at: Date | null }[] = [];
  body.forEach((cells, i) => {
    try {
      const data: Record<string, string | boolean | number> = {};
      for (const c of table.columns) {
        const at = index.get(c.key);
        if (at === undefined) continue; // not in the file: nothing to say about it
        const raw = (cells[at] ?? "").replace(/^'(?=[=+\-@])/, "");
        const v = readField({ name: c.key, label: c.label, type: c.type, required: false, options: undefined, width: "full" } as never, raw, { anyOption: true, yesNo: true });
        if (v !== undefined) data[c.key] = v;
      }
      if (!Object.keys(data).length) throw new UserError("The row is empty.");
      const when = receivedAt >= 0 ? new Date(cells[receivedAt] ?? "") : null;
      good.push({ data, page: pageAt >= 0 ? (cells[pageAt] || null)?.slice(0, 200) ?? null : null, at: when && !Number.isNaN(when.getTime()) ? when : null });
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      skipped.push({ line: i + 2, reason: e.message });
    }
  });

  const result: ImportResult = { added: 0, updated: 0, duplicates: 0, removed: 0, skipped: skipped.slice(0, 50) };
  if (!good.length) return result;

  let toInsert = good;
  if (mode === "replace") {
    const gone = await tx.query<{ id: number }>("delete from site_table_rows where table_id = $1 returning id", [table.id]);
    result.removed = gone.length;
  } else if (mode === "update" || mode === "skip") {
    const existing = new Map<string, number>();
    const rows = await tx.query<{ id: number; data: Record<string, unknown> }>("select id, data from site_table_rows where table_id = $1 order by id", [table.id]);
    for (const r of rows) {
      const k = matchKey(table, r.data, matchOn);
      if (k && !existing.has(k)) existing.set(k, r.id);
    }
    const seen = new Map<string, (typeof good)[number]>();
    toInsert = [];
    for (const g of good) {
      const k = matchKey(table, g.data, matchOn);
      const id = k ? existing.get(k) : undefined;
      if (id !== undefined) {
        result.duplicates++;
        if (mode === "update") {
          // The file's values win; columns the file left blank keep what the row had.
          await tx.query("update site_table_rows set data = data || $2::jsonb where id = $1", [id, JSON.stringify(g.data)]);
          result.updated++;
        }
        continue;
      }
      // The same row twice in one file: the later one, as a spreadsheet's last edit would.
      if (k && seen.has(k)) {
        result.duplicates++;
        if (mode === "update") Object.assign(seen.get(k)!.data, g.data);
        continue;
      }
      if (k) seen.set(k, g);
      toInsert.push(g);
    }
  }
  if (toInsert.length) {
    await tx.query(
      `insert into site_table_rows (tenant_id, table_id, data, page, created_at)
       select app_tenant(), $1, d, p, coalesce(a, now()) from unnest($2::jsonb[], $3::text[], $4::timestamptz[]) as t(d, p, a)`,
      [table.id, toInsert.map((g) => JSON.stringify(g.data)), toInsert.map((g) => g.page), toInsert.map((g) => g.at)],
    );
  }
  result.added = toInsert.length;
  return result;
}

// ---------------------------------------------------------------------------
// Submissions from the live site
// ---------------------------------------------------------------------------

type FormBlock = Extract<Section, { type: "form" }>;

function findForm(tree: SiteTree, sectionId: string): FormBlock | null {
  for (const p of tree.pages) for (const s of p.sections) if (s.id === sectionId && s.type === "form") return s as FormBlock;
  return null;
}

/** One answer, checked against its field. */
function readField(
  field: FormBlock["props"]["fields"][number],
  raw: string | null,
  /** For imports: a table column has no option list, and a sheet says yes/no rather than ticking. */
  opts: { anyOption?: boolean; yesNo?: boolean } = {},
): string | boolean | number | undefined {
  const v = (raw ?? "").trim();
  if (field.type === "checkbox") {
    if (field.required && !v) throw new UserError(`Please tick “${field.label}”.`);
    if (opts.yesNo) return v ? /^(yes|y|true|1|on|x|✓)$/i.test(v) : undefined;
    return Boolean(v);
  }
  if (!v) {
    if (field.required) throw new UserError(`Please fill in “${field.label}”.`);
    return undefined;
  }
  const max = field.type === "textarea" ? 4000 : 300;
  if (v.length > max) throw new UserError(`“${field.label}” is too long.`);
  switch (field.type) {
    case "email":
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new UserError(`“${field.label}” needs an email address.`);
      return v.toLowerCase();
    case "tel":
      if (!/^[+\d][\d\s()-]{6,20}$/.test(v)) throw new UserError(`“${field.label}” needs a phone number.`);
      return v;
    case "number": {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new UserError(`“${field.label}” needs a number.`);
      return n;
    }
    case "date":
      if (Number.isNaN(Date.parse(v))) throw new UserError(`“${field.label}” needs a date.`);
      return v.slice(0, 10);
    case "select":
      if (!opts.anyOption && !(field.options ?? []).includes(v)) throw new UserError(`Choose one of the options for “${field.label}”.`);
      return v;
    default:
      return v;
  }
}

/**
 * A visitor sent a form. `get(name)` reads the posted fields. Spam checks: a
 * hidden field people never fill, and a minimum time on the page.
 */
export async function submitForm(
  r: ResolvedSite,
  input: { section: string; page: string; get: (name: string) => string | null; startedAt?: number },
): Promise<{ message: string }> {
  const site = await loadPublished(r);
  if (!site) throw new UserError("This site is not available.");
  const form = findForm(site.tree, input.section);
  if (!form || form.props.destination.kind !== "table") throw new UserError("This form is no longer on the site.");
  // A bot fills the hidden field, or answers faster than a person can read.
  if (input.get("_website")) return { message: form.props.successMessage };
  if (input.startedAt && Date.now() - input.startedAt < 1500) return { message: form.props.successMessage };

  const data: Record<string, string | boolean | number> = {};
  for (const field of form.props.fields) {
    const value = readField(field, input.get(field.name));
    if (value !== undefined) data[field.name] = value;
  }
  const tableKey = form.props.destination.table;
  await withTenant(r.tenantId, async (tx) => {
    const table = await tx.one<SiteTable>(`select ${COLUMNS} from site_tables where site_id = $1 and key = $2`, [r.siteId, tableKey]);
    if (!table) throw new UserError("This form is not accepting answers right now.");
    await tx.query("insert into site_table_rows (tenant_id, table_id, data, page) values (app_tenant(), $1, $2, $3)", [
      table.id,
      JSON.stringify(data),
      input.page.slice(0, 200),
    ]);
    if (table.notify) {
      const alerts = await getAlerts(tx);
      const lines = form.props.fields.map((f) => `${f.label}: ${data[f.name] === undefined ? "—" : data[f.name] === true ? "yes" : data[f.name] === false ? "no" : data[f.name]}`);
      for (const to of alerts.emails) {
        const text = `Someone sent the ${form.props.heading ?? table.name} form on ${site.site.name} (${input.page}).\n\n${lines.join("\n")}\n\nSee every answer in Zuuvy Studio → ${site.site.name} → Data.`;
        await queueEmail(tx, {
          to,
          from: "alerts",
          subject: `New ${table.name} on ${site.site.name}`,
          text,
          html: `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`,
        });
      }
    }
  });
  return { message: form.props.successMessage };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
