import { listIntegrations, listOrders, listSites, withTenant } from "@zsite/platform";
import Link from "next/link";
import { OrderStatusBadge } from "@/components/badges";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, Icon, PageHeader } from "@/components/ui";
import { ago, inr } from "@/lib/format";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Overview" };

export default async function Overview() {
  const session = await requireSession();
  const { sites, integrations, orders } = await withTenant(session.tenant.id, async (tx) => ({
    sites: await listSites(tx),
    integrations: await listIntegrations(tx),
    orders: await listOrders(tx, { limit: 6 }),
  }));
  const zuuvy = integrations.find((i) => i.kind === "zuuvy" && i.status !== "disconnected");
  // Orders and connections live under their store; with one store that is where "all" is.
  const stores = sites.filter((s) => s.kind === "store");
  const home = stores.length === 1 ? `/sites/${stores[0]!.id}` : "";

  return (
    <>
      <PageHeader
        title={`Hello, ${session.user.name.split(" ")[0]}`}
        description="Your sites, what is connected to them, and the latest orders."
        actions={<ButtonLink href="/sites/new"><Icon name="plus" /> New site</ButtonLink>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Sites" actions={<Link href="/sites" className="text-xs font-medium text-brand-600 hover:underline">All sites</Link>} />
            {sites.length === 0 ? (
              <EmptyState
                icon="globe"
                title="No sites yet"
                body="Pick a template and the AI will shape it around your business."
                action={<ButtonLink href="/sites/new">Create your first site</ButtonLink>}
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {sites.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <Link href={`/sites/${s.id}`} className="font-medium text-slate-900 hover:underline">{s.name}</Link>
                      <a href={s.url} target="_blank" rel="noreferrer" className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 hover:text-brand-600">
                        {s.url.replace(/^https?:\/\//, "")} <Icon name="external" className="h-3 w-3" />
                      </a>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.published_number && <Badge tone="green">Live · v{s.published_number}</Badge>}
                      {s.latest_number !== s.published_number && <Badge tone="amber">v{s.latest_number} unpublished</Badge>}
                    </div>
                    <ButtonLink href={`/sites/${s.id}/versions`} variant="secondary" size="sm">Versions</ButtonLink>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Latest orders" actions={<Link href={`${home}/orders`} className="text-xs font-medium text-brand-600 hover:underline">All orders</Link>} />
            {orders.length === 0 ? (
              <EmptyState icon="cart" title="No orders yet" body="Orders placed on your store appear here and in Zuuvy." />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {orders.map((o) => (
                  <li key={o.id}>
                    <Link href={o.site_id ? `/sites/${o.site_id}/orders/${o.id}` : `/orders/${o.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
                      <span className="w-16 font-mono text-xs text-slate-500">WEB-{o.number}</span>
                      <span className="min-w-0 flex-1 truncate">{o.customer.name}</span>
                      <span className="font-medium">{inr(o.total)}</span>
                      <OrderStatusBadge status={o.status} />
                      <span className="hidden w-20 text-right text-xs text-slate-500 sm:block">{ago(o.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Zuuvy" description="Catalogue, stock and orders" />
            <div className="p-5 text-sm">
              {zuuvy ? (
                <>
                  <div className="flex items-center gap-2">
                    <Badge tone={zuuvy.status === "connected" ? "green" : "red"}>{zuuvy.status === "connected" ? "Connected" : "Needs attention"}</Badge>
                    <span className="truncate text-slate-600">{zuuvy.config.info?.headline}</span>
                  </div>
                  <p className="mt-3 text-slate-500">Last catalogue sync {ago(zuuvy.last_sync_at)}.</p>
                  {zuuvy.last_error && <p className="mt-2 text-rose-700">{zuuvy.last_error}</p>}
                  <ButtonLink href={`${home}/integrations/zuuvy`} variant="secondary" size="sm" className="mt-4">Manage</ButtonLink>
                </>
              ) : (
                <>
                  <p className="text-slate-600">Connect Zuuvy to list the products you mark for online sale and receive orders in Zuuvy.</p>
                  <ButtonLink href={`${home}/integrations/zuuvy`} size="sm" className="mt-4">Connect Zuuvy</ButtonLink>
                </>
              )}
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Icon name="sparkles" /></div>
              <div className="text-sm">
                <p className="font-medium text-slate-900">Change anything by describing it</p>
                <p className="mt-1 text-slate-500">Open a site's versions and tell the AI what you want. Each change becomes a version you can preview, compare and publish — or roll back.</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
