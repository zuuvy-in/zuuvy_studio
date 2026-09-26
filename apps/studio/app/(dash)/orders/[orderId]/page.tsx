import { NotFound, STATUS_LABELS, getOrder, isUuid, withTenant } from "@zsite/platform";
import { notFound } from "next/navigation";
import { OrderStatusBadge, SyncBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardHeader, Dl, PageHeader } from "@/components/ui";
import { dateTime, inr } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { retrySyncAction } from "../actions";

export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!isUuid(orderId)) notFound();
  const session = await requireSession();
  const order = await withTenant(session.tenant.id, (tx) => getOrder(tx, orderId)).catch((e) => {
    if (e instanceof NotFound) notFound();
    throw e;
  });
  return (
    <>
      <PageHeader
        eyebrow="Orders"
        title={<span className="flex items-center gap-3">WEB-{order.number} <OrderStatusBadge status={order.status} /></span>}
        description={`Placed ${dateTime(order.created_at)} · cash on delivery`}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Items" />
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {order.lines.map((l) => (
                  <tr key={l.productId}>
                    <td className="px-5 py-3">
                      <p className="font-medium">{l.name}</p>
                      <p className="text-xs text-slate-500">{l.quantity} × {inr(l.unitPrice)}</p>
                    </td>
                    <td className="px-5 py-3 text-right font-medium">{inr(l.lineTotal)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50">
                  <td className="px-5 py-3 font-semibold">Total</td>
                  <td className="px-5 py-3 text-right font-semibold">{inr(order.total)}</td>
                </tr>
              </tbody>
            </table>
          </Card>
          <Card>
            <CardHeader title="Timeline" />
            <ol className="px-5 py-4">
              {order.events.map((e) => (
                <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                  <div className="text-sm">
                    <p className="font-medium text-slate-800">{e.note || STATUS_LABELS[e.status as keyof typeof STATUS_LABELS] || e.status}</p>
                    <p className="text-xs text-slate-500">{dateTime(e.created_at)} · {e.source}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <aside className="space-y-6">
          <Card>
            <CardHeader title="Customer" />
            <Dl items={[["Name", order.customer.name], ["Mobile", order.customer.phone], ["Address", order.customer.address]]} />
            {order.note && <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-600">Note: {order.note}</p>}
          </Card>
          <Card>
            <CardHeader title="Zuuvy" />
            <Dl
              items={[
                ["Sync", <SyncBadge key="s" state={order.sync_state} />],
                ["Zuuvy order", order.external_ref ? `#${order.external_ref}` : "—"],
                ["Zuuvy status", order.external_status ?? "—"],
              ]}
            />
            {order.sync_error && <p className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-800">{order.sync_error}</p>}
            {(order.sync_state === "failed" || order.sync_state === "not_linked") && (
              <ActionForm action={retrySyncAction} className="border-t border-slate-100 px-5 py-4">
                <input type="hidden" name="orderId" value={order.id} />
                <SubmitButton size="sm" pending="Queuing…">Send to Zuuvy</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
