import { orderByToken } from "@zsite/platform";
import { SiteShell, SystemFrame, commerceOf } from "@zsite/runtime";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { chromeContext } from "@/lib/shop";
import { currentSite } from "@/lib/site";
import { OrderView } from "../view";

export const metadata: Metadata = { title: "Your order", robots: { index: false } };

export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const current = await currentSite();
  if (!current) notFound();
  const found = await orderByToken((await params).token);
  // The link is a secret, but it still only opens on the store it belongs to.
  if (!found || found.tenantId !== current.resolved.tenantId) notFound();
  const { order } = found;
  const ctx = await chromeContext(current);
  return (
    <SiteShell tree={current.site.tree} ctx={ctx}>
      <SystemFrame pages={commerceOf(current.site.tree).pages}>
        <div className="zs-narrow" style={{ marginInline: "auto" }}>
          <OrderView order={order} thanks={commerceOf(current.site.tree).pages.thanks} />
        </div>
      </SystemFrame>
    </SiteShell>
  );
}
