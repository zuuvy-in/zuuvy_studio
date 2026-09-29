import { NotFound, getSiteTable, isUuid, listRows, withTenant } from "@zsite/platform";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardHeader, EmptyState, Icon, buttonClass } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { deleteRowsAction, deleteTableAction, notifyAction } from "../actions";

export const metadata = { title: "Form answers" };

const show = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : v === true ? "Yes" : v === false ? "No" : String(v));

export default async function TablePage({ params }: { params: Promise<{ siteId: string; tableId: string }> }) {
  const { siteId, tableId } = await params;
  if (!isUuid(tableId)) notFound();
  const session = await requireSession();
  const { table, rows } = await withTenant(session.tenant.id, async (tx) => {
    const table = await getSiteTable(tx, siteId, tableId);
    return { table, rows: await listRows(tx, table.id, { limit: 500 }) };
  }).catch((e) => {
    if (e instanceof NotFound) notFound();
    throw e;
  });
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href={`/sites/${siteId}/forms`} className="text-sm text-slate-500 hover:text-slate-800">← Forms</Link>
          <h2 className="text-lg font-semibold">{table.name}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionForm action={notifyAction}>
            <input type="hidden" name="siteId" value={siteId} />
            <input type="hidden" name="tableId" value={table.id} />
            <input type="hidden" name="notify" value={table.notify ? "0" : "1"} />
            <SubmitButton variant="secondary" pending="Saving…">{table.notify ? "Stop emailing me" : "Email me each answer"}</SubmitButton>
          </ActionForm>
          {rows.length > 0 && (
            <a href={`/sites/${siteId}/forms/${table.id}/csv`} className={buttonClass("secondary")}>
              <Icon name="download" /> Download CSV
            </a>
          )}
        </div>
      </div>

      <Card className="overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState icon="table" title="No answers yet" body="What visitors send through the form on your published site appears here." />
        ) : (
          <ActionForm action={deleteRowsAction}>
            <input type="hidden" name="siteId" value={siteId} />
            <input type="hidden" name="tableId" value={table.id} />
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
                <tr>
                  <th className="w-8 px-4 py-3" />
                  <th className="px-3 py-3 font-medium whitespace-nowrap">Received</th>
                  {table.columns.map((c) => <th key={c.key} className="px-3 py-3 font-medium">{c.label}</th>)}
                  <th className="px-3 py-3 font-medium">Page</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 align-top">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3"><input type="checkbox" name="row" value={r.id} aria-label="Select answer" /></td>
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
            <div className="border-t border-slate-100 px-4 py-3">
              <SubmitButton variant="secondary" size="sm" pending="Deleting…" confirm="Delete the ticked answers? This cannot be undone.">
                <Icon name="trash" /> Delete selected
              </SubmitButton>
            </div>
          </ActionForm>
        )}
      </Card>

      <Card className="border-rose-200">
        <CardHeader title="Delete this table" description="Removes the table and every answer in it. A form still pointing at it stops accepting answers until the AI gives it a new table." />
        <ActionForm action={deleteTableAction} className="p-5 pt-0">
          <input type="hidden" name="siteId" value={siteId} />
          <input type="hidden" name="table" value={table.id} />
          <SubmitButton variant="danger" pending="Deleting…" confirm={`Delete ${table.name} and all ${rows.length} answers?`}>Delete table</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
