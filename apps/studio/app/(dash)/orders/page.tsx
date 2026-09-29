import { listOrders, listSites, withTenant } from "@zsite/platform";
import Link from "next/link";
import { OrderStatusBadge, SyncBadge } from "@/components/badges";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ago, inr } from "@/lib/format";
import { pageScope } from "@/lib/scope";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Orders" };

export default async function OrdersPage({ params }: { params: Promise<{ siteId?: string }> }) {
  const session = await requireSession();
  const { siteId, base } = await pageScope(params);
  const { orders, sites } = await withTenant(session.tenant.id, async (tx) => ({
    orders: await listOrders(tx, { limit: 200, siteId }),
    // Business-wide, every row says which store it came from.
    sites: siteId ? new Map<string, string>() : new Map((await listSites(tx)).map((s) => [s.id, s.name])),
  }));
  return (
    <>
      <PageHeader title="Orders" description={`${siteId ? "Orders placed on this store." : "Orders from all your stores."} Each one is sent to Zuuvy, and its status follows what your team does there.`} />
      <Card className="overflow-x-auto">
        {orders.length === 0 ? (
          <EmptyState icon="cart" title="No orders yet" body="When a customer orders from your store it appears here." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Order</th>
                {!siteId && <th className="px-3 py-3 font-medium">Store</th>}
                <th className="px-3 py-3 font-medium">Customer</th>
                <th className="px-3 py-3 font-medium">Items</th>
                <th className="px-3 py-3 text-right font-medium">Total</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Zuuvy</th>
                <th className="px-5 py-3 text-right font-medium">Placed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3"><Link href={`${base}/orders/${o.id}`} className="font-mono text-xs font-semibold text-brand-700 hover:underline">WEB-{o.number}</Link></td>
                  {!siteId && <td className="px-3 py-3 text-slate-600">{(o.site_id && sites.get(o.site_id)) ?? "—"}</td>}
                  <td className="px-3 py-3"><p className="font-medium">{o.customer.name}</p><p className="text-xs text-slate-500">{o.customer.phone}</p></td>
                  <td className="px-3 py-3 text-slate-600">{o.lines.reduce((n, l) => n + l.quantity, 0)}</td>
                  <td className="px-3 py-3 text-right font-medium">{inr(o.total)}</td>
                  <td className="px-3 py-3"><OrderStatusBadge status={o.status} /></td>
                  <td className="px-3 py-3"><SyncBadge state={o.sync_state} />{o.external_ref && <span className="ml-1 text-xs text-slate-500">#{o.external_ref}</span>}</td>
                  <td className="px-5 py-3 text-right text-xs text-slate-500">{ago(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
