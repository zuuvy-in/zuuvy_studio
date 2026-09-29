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
// Submissions from the live site
// ---------------------------------------------------------------------------

type FormBlock = Extract<Section, { type: "form" }>;

function findForm(tree: SiteTree, sectionId: string): FormBlock | null {
  for (const p of tree.pages) for (const s of p.sections) if (s.id === sectionId && s.type === "form") return s as FormBlock;
  return null;
}

/** One answer, checked against its field. */
function readField(field: FormBlock["props"]["fields"][number], raw: string | null): string | boolean | number | undefined {
  const v = (raw ?? "").trim();
  if (field.type === "checkbox") {
    if (field.required && !v) throw new UserError(`Please tick “${field.label}”.`);
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
      if (!(field.options ?? []).includes(v)) throw new UserError(`Choose one of the options for “${field.label}”.`);
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
        const text = `Someone sent the ${form.props.heading ?? table.name} form on ${site.site.name} (${input.page}).\n\n${lines.join("\n")}\n\nSee every answer in Zuuvy Studio → ${site.site.name} → Forms.`;
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
