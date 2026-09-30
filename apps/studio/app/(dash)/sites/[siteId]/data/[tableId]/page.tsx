import { NotFound, defaultMatch, getSiteTable, isUuid, queryRows, withTenant } from "@zsite/platform";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardHeader, EmptyState, Icon, buttonClass } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { type Search, rowQuery, withQuery } from "@/lib/rows-query";
import { requireSession } from "@/lib/session";
import { deleteRowsAction, deleteTableAction, importRowsAction, notifyAction } from "../actions";

export const metadata = { title: "Data" };

const IMPORT_CHOICES = [
  { value: "append", label: "Add to the table", help: "Every row in the file is added; nothing here changes." },
  { value: "update", label: "Overwrite duplicates", help: "A row matching one here replaces its values; new rows are added." },
  { value: "skip", label: "Skip duplicates", help: "Rows already here are left alone; only new rows are added." },
  { value: "replace", label: "Replace the table", help: "Every row here is deleted first, then the file is added." },
] as const;

const show = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : v === true ? "Yes" : v === false ? "No" : String(v));

export default async function TablePage({ params, searchParams }: { params: Promise<{ siteId: string; tableId: string }>; searchParams: Promise<Search> }) {
  const { siteId, tableId } = await params;
  const search = await searchParams;
  if (!isUuid(tableId)) notFound();
  const session = await requireSession();
  const { table, result, options } = await withTenant(session.tenant.id, async (tx) => {
    const table = await getSiteTable(tx, siteId, tableId);
    const result = await queryRows(tx, table, rowQuery(table, search));
    // Choices for select columns: whatever values the table holds.
    const options: Record<string, string[]> = {};
    for (const c of table.columns.filter((c) => c.type === "select")) {
      const rows = await tx.query<{ v: string }>(
        "select distinct data->>$2 as v from site_table_rows where table_id = $1 and data->>$2 is not null order by 1 limit 50",
        [table.id, c.key],
      );
      options[c.key] = rows.map((r) => r.v);
    }
    return { table, result, options };
  }).catch((e) => {
    if (e instanceof NotFound) notFound();
    throw e;
  });
  const query = rowQuery(table, search);
  const match = defaultMatch(table);
  const filtered = Boolean(query.q || Object.keys(query.filters ?? {}).length);
  const base = `/sites/${siteId}/data/${table.id}`;
  const sortLink = (key: string) => {
    const on = (query.sort ?? "received") === key;
    return withQuery(search, { sort: key === "received" ? null : key, dir: on && query.dir === "desc" ? "asc" : "desc", page: null });
  };
  const arrow = (key: string) => ((query.sort ?? "received") === key ? (query.dir === "asc" ? " ↑" : " ↓") : "");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href={`/sites/${siteId}/data`} className="text-sm text-slate-500 hover:text-slate-800">← Data</Link>
          <h2 className="text-lg font-semibold">{table.name}</h2>
          <p className="text-xs text-slate-500">
            {result.total} {filtered ? "matching " : ""}{result.total === 1 ? "row" : "rows"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionForm action={notifyAction}>
            <input type="hidden" name="siteId" value={siteId} />
            <input type="hidden" name="tableId" value={table.id} />
            <input type="hidden" name="notify" value={table.notify ? "0" : "1"} />
            <SubmitButton variant="secondary" pending="Saving…">{table.notify ? "Stop emailing me" : "Email me new rows"}</SubmitButton>
          </ActionForm>
          <a href={`${base}/csv${withQuery(search, { page: null })}`} className={buttonClass("secondary")}>
            <Icon name="download" /> Export {filtered ? "these" : "all"} as CSV
          </a>
        </div>
      </div>

      <Card className="p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {query.sort && <input type="hidden" name="sort" value={query.sort} />}
          {query.dir === "asc" && <input type="hidden" name="dir" value="asc" />}
          <div className="sm:col-span-2">
            <label className="label" htmlFor="q">Search</label>
            <input id="q" name="q" defaultValue={query.q} placeholder="Anything in the row" className="field" />
          </div>
          {table.columns.map((c) => (
            <div key={c.key}>
              <label className="label" htmlFor={`f_${c.key}`}>{c.label}</label>
              {c.type === "select" || c.type === "checkbox" ? (
                <select id={`f_${c.key}`} name={`f_${c.key}`} defaultValue={query.filters?.[c.key] ?? ""} className="field">
                  <option value="">Any</option>
                  {(c.type === "checkbox" ? ["Yes", "No"] : options[c.key] ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input id={`f_${c.key}`} name={`f_${c.key}`} defaultValue={query.filters?.[c.key] ?? ""} placeholder="Contains…" className="field" />
              )}
            </div>
          ))}
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button className={buttonClass("primary", "sm")}>Apply</button>
            {filtered && <Link href={base + withQuery(search, { q: null, page: null, ...Object.fromEntries(table.columns.map((c) => [`f_${c.key}`, null])) })} className={buttonClass("ghost", "sm")}>Clear</Link>}
          </div>
        </form>
      </Card>

      <Card className="overflow-x-auto">
        {result.rows.length === 0 ? (
          <EmptyState icon="table" title={filtered ? "Nothing matches" : "No rows yet"} body={filtered ? "Try fewer filters." : "What visitors send through the form on your published site appears here. You can also import a CSV below."} />
        ) : (
          <ActionForm action={deleteRowsAction}>
            <input type="hidden" name="siteId" value={siteId} />
            <input type="hidden" name="tableId" value={table.id} />
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
                <tr>
                  <th className="w-8 px-4 py-3" />
                  <th className="px-3 py-3 font-medium whitespace-nowrap"><Link href={base + sortLink("received")} className="hover:text-slate-900">Received{arrow("received")}</Link></th>
                  {table.columns.map((c) => (
                    <th key={c.key} className="px-3 py-3 font-medium whitespace-nowrap">
                      <Link href={base + sortLink(c.key)} className="hover:text-slate-900">{c.label}{arrow(c.key)}</Link>
                    </th>
                  ))}
                  <th className="px-3 py-3 font-medium">Page</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 align-top">
                {result.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3"><input type="checkbox" name="row" value={r.id} aria-label="Select row" /></td>
                    <td className="px-3 py-3 whitespace-nowrap text-slate-600">{dateTime(r.created_at)}</td>
                    {table.columns.map((c) => (
                      <td key={c.key} className="max-w-xs px-3 py-3 break-words whitespace-pre-line text-slate-800">
                        {c.type === "email" && r.data[c.key] ? <a className="text-brand-700 underline" href={`mailto:${r.data[c.key]}`}>{show(r.data[c.key])}</a>
                          : c.type === "tel" && r.data[c.key] ? <a className="text-brand-700 underline" href={`tel:${String(r.data[c.key]).replace(/[^\d+]/g, "")}`}>{show(r.data[c.key])}</a>
                          : show(r.data[c.key])}
                      </td>
                    ))}
                    <td className="px-3 py-3 text-slate-500">{r.page ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
              <SubmitButton variant="secondary" size="sm" pending="Deleting…" confirm="Delete the ticked rows? This cannot be undone.">
                <Icon name="trash" /> Delete selected
              </SubmitButton>
              {result.pages > 1 && (
                <nav className="flex items-center gap-2 text-sm text-slate-600" aria-label="Pages">
                  {result.page > 1 && <Link href={base + withQuery(search, { page: result.page - 1 })} className={buttonClass("ghost", "sm")}>← Newer</Link>}
                  <span>Page {result.page} of {result.pages}</span>
                  {result.page < result.pages && <Link href={base + withQuery(search, { page: result.page + 1 })} className={buttonClass("ghost", "sm")}>Older →</Link>}
                </nav>
              )}
            </div>
          </ActionForm>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Import rows"
          description={`A CSV whose first row names the columns: ${table.columns.map((c) => c.label).join(", ")}. Any order; other columns are ignored, and a file exported from here imports as it is. Rows that do not fit are skipped and listed.`}
        />
        <ActionForm action={importRowsAction} className="space-y-4 p-5 pt-0" resetOnOk>
          <input type="hidden" name="siteId" value={siteId} />
          <input type="hidden" name="tableId" value={table.id} />
          <input type="file" name="file" accept=".csv,text/csv" required className="block text-sm" />
          <fieldset>
            <legend className="label">The rows already here</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {IMPORT_CHOICES.map((m, i) => (
                <label key={m.value} className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/40">
                  <input type="radio" name="mode" value={m.value} defaultChecked={i === 0} className="mt-0.5" />
                  <span><strong className="text-slate-900">{m.label}</strong><br /><span className="text-xs text-slate-500">{m.help}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="label">A duplicate is a row with the same…</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {table.columns.map((c) => (
                <label key={c.key} className="flex items-center gap-1.5">
                  <input type="checkbox" name="matchOn" value={c.key} defaultChecked={match.includes(c.key)} /> {c.label}
                </label>
              ))}
            </div>
            <p className="help">Used by “Overwrite duplicates” and “Skip duplicates”. Tick none to match rows that are the same in every column. Case and extra spaces are ignored.</p>
          </fieldset>
          <SubmitButton variant="secondary" pending="Importing…" confirm="Import this file? “Replace the table” deletes every row that is here now."><Icon name="upload" /> Import</SubmitButton>
        </ActionForm>
      </Card>

      <Card className="border-rose-200">
        <CardHeader title="Delete this table" description="Removes the table and every row in it. A form still pointing at it stops accepting answers until the AI gives it a new table." />
        <ActionForm action={deleteTableAction} className="p-5 pt-0">
          <input type="hidden" name="siteId" value={siteId} />
          <input type="hidden" name="table" value={table.id} />
          <SubmitButton variant="danger" pending="Deleting…" confirm={`Delete ${table.name} and all ${result.total} rows?`}>Delete table</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
