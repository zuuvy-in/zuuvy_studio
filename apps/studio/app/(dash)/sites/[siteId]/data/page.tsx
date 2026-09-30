import { latestVersion, listSiteTables, withTenant } from "@zsite/platform";
import Link from "next/link";
import { Badge, Card, EmptyState, Icon } from "@/components/ui";
import { ago } from "@/lib/format";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Forms" };

export default async function FormsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const session = await requireSession();
  const { tables, usedBy } = await withTenant(session.tenant.id, async (tx) => {
    const tables = await listSiteTables(tx, siteId);
    const tree = (await latestVersion(tx, siteId)).tree;
    // Which page's form fills each table, so a table nobody fills any more is visible.
    const usedBy = new Map<string, string[]>();
    for (const p of tree?.pages ?? [])
      for (const s of p.sections)
        if (s.type === "form" && s.props.destination.kind === "table") {
          const list = usedBy.get(s.props.destination.table) ?? [];
          list.push(p.title);
          usedBy.set(s.props.destination.table, list);
        }
    return { tables, usedBy };
  });
  if (!tables.length) {
    return (
      <Card>
        <EmptyState
          icon="table"
          title="No data yet"
          body="Tables appear here when the AI makes a form for you. Ask for one — “add a contact form”, “a booking form with date and party size” — and it makes the form and the table its answers go into."
        />
      </Card>
    );
  }
  return (
    <Card className="divide-y divide-slate-100">
      {tables.map((t) => {
        const pages = usedBy.get(t.key) ?? [];
        return (
          <Link key={t.id} href={`/sites/${siteId}/data/${t.id}`} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-medium text-slate-900">
                {t.name} {!t.notify && <Badge>No emails</Badge>}
                {pages.length === 0 && <Badge tone="amber">No form on the site</Badge>}
              </p>
              <p className="truncate text-xs text-slate-500">
                {t.columns.map((c) => c.label).join(" · ")}
                {pages.length > 0 && ` — on ${pages.join(", ")}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-sm text-slate-600">
              <span>{t.rows ?? 0} {t.rows === 1 ? "answer" : "answers"}</span>
              <span className="hidden text-xs text-slate-400 sm:inline">updated {ago(t.updated_at)}</span>
              <Icon name="arrowOut" className="text-slate-400" />
            </div>
          </Link>
        );
      })}
    </Card>
  );
}
