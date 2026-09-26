import { orderByToken } from "@zsite/platform";
import { SiteShell, linkRewriter } from "@zsite/runtime";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentSite } from "@/lib/site";

export const metadata: Metadata = { title: "Your order", robots: { index: false } };

const LABEL: Record<string, string> = {
  pending: "Order placed — waiting for the shop to confirm",
  confirmed: "Confirmed by the shop",
  packed: "Packed",
  shipped: "Out for delivery",
  delivered: "Delivered",
  rejected: "The shop could not take this order",
  cancelled: "Cancelled",
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const current = await currentSite();
  if (!current) notFound();
  const found = await orderByToken((await params).token);
  // The link is a secret, but it still only opens on the store it belongs to.
  if (!found || found.tenantId !== current.resolved.tenantId) notFound();
  const { order } = found;
  const ctx = { mode: "live" as const, href: linkRewriter(""), products: [] };
  return (
    <SiteShell tree={current.site.tree} ctx={ctx}>
      <div className="zs-container zs-page zs-narrow">
        <p className="zs-eyebrow">Order WEB-{order.number}</p>
        <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.4rem)" }}>
          {order.status === "pending" ? `Thank you, ${order.customerName.split(" ")[0]}!` : LABEL[order.status]}
        </h1>
        <p className="zs-lede">
          {order.status === "pending"
            ? "Your order is with the shop. They will confirm it shortly — keep this page to follow it."
            : "Keep this page to follow your order."}
        </p>
        <ol className="zs-steps">
          {order.events.map((e, i) => (
            <li key={i}>
              <div>
                <strong>{LABEL[e.status] ?? e.note}</strong>
                <small>{new Date(e.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small>
              </div>
            </li>
          ))}
        </ol>
        <div className="zs-card">
          <table className="zs-summary">
            <tbody>
              {order.lines.map((l) => (
                <tr key={l.productId}>
                  <td>{l.quantity} × {l.name}</td>
                  <td>{inr(l.lineTotal)}</td>
                </tr>
              ))}
              <tr>
                <td><strong>Total — pay on delivery</strong></td>
                <td>{inr(order.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </SiteShell>
  );
}
