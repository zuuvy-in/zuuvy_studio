import { listSites, withTenant } from "@zsite/platform";
import Link from "next/link";
import { Badge, ButtonLink, Card, EmptyState, Icon, PageHeader } from "@/components/ui";
import { ago } from "@/lib/format";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Sites" };

const KIND = { store: "Store", landing: "Landing page", portfolio: "Portfolio" } as const;

export default async function SitesPage() {
  const session = await requireSession();
  const sites = await withTenant(session.tenant.id, listSites);
  return (
    <>
      <PageHeader title="Sites" description="Every site this business runs." actions={<ButtonLink href="/sites/new"><Icon name="plus" /> New site</ButtonLink>} />
      {sites.length === 0 ? (
        <Card>
          <EmptyState icon="globe" title="No sites yet" action={<ButtonLink href="/sites/new">Create a site</ButtonLink>} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((s) => (
            <Card key={s.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/sites/${s.id}`} className="font-semibold text-slate-900 hover:underline">{s.name}</Link>
                  <p className="text-xs text-slate-500">{KIND[s.kind]} · runtime {s.runtime_version}</p>
                </div>
                {s.published_number ? <Badge tone="green">Live v{s.published_number}</Badge> : <Badge>Draft</Badge>}
              </div>
              <a href={s.url} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-1 truncate text-sm text-brand-600 hover:underline">
                {s.url.replace(/^https?:\/\//, "")} <Icon name="external" className="h-3.5 w-3.5" />
              </a>
              <p className="mt-1 text-xs text-slate-500">
                {s.latest_number} version{s.latest_number === 1 ? "" : "s"} · updated {ago(s.updated_at)}
              </p>
              <div className="mt-5 flex gap-2">
                <ButtonLink href={`/sites/${s.id}/versions`} size="sm">Versions</ButtonLink>
                <ButtonLink href={`/sites/${s.id}/settings`} size="sm" variant="secondary">Settings</ButtonLink>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
