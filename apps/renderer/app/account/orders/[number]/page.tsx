import { customerOrder } from "@zsite/platform";
import { SiteShell } from "@zsite/runtime";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { OrderView } from "@/app/order/view";
import { chromeContext, currentCustomer, hasAccounts } from "@/lib/shop";
import { currentSite } from "@/lib/site";

export const metadata: Metadata = { title: "Your order", robots: { index: false } };

export default async function AccountOrderPage({ params }: { params: Promise<{ number: string }> }) {
  const current = await currentSite();
  if (!current || !hasAccounts(current)) notFound();
  const { number } = await params;
  const customer = await currentCustomer(current);
  if (!customer) redirect(`/account?next=/account/orders/${encodeURIComponent(number)}`);
  // Only this customer's own orders: anyone else's number finds nothing.
  const order = await customerOrder(current.resolved.tenantId, customer.id, Number(number));
  if (!order) notFound();
  const ctx = await chromeContext(current);
  return (
    <SiteShell tree={current.site.tree} ctx={ctx}>
      <div className="zs-container zs-page zs-narrow">
        <p>
          <a href="/account" className="zs-muted">← All your orders</a>
        </p>
        <OrderView order={order} />
      </div>
    </SiteShell>
  );
}
