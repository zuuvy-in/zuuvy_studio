import type { SystemPages } from "@zsite/core";
import type { PublicOrder } from "@zsite/platform";

export const STATUS_LABEL: Record<string, string> = {
  pending: "Order placed — waiting for the shop to confirm",
  confirmed: "Confirmed by the shop",
  packed: "Packed",
  shipped: "Out for delivery",
  delivered: "Delivered",
  rejected: "The shop could not take this order",
  cancelled: "Cancelled",
};

export const SHORT_STATUS: Record<string, string> = {
  pending: "Placed",
  confirmed: "Confirmed",
  packed: "Packed",
  shipped: "On the way",
  delivered: "Delivered",
  rejected: "Declined",
  cancelled: "Cancelled",
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** One order: where it has got to, and what was in it. The same view for a guest's link and an account. */
export function OrderView({ order, thanks }: { order: PublicOrder; thanks?: SystemPages["thanks"] }) {
  const first = order.customerName.split(" ")[0]!;
  return (
    <>
      <p className="zs-eyebrow">Order WEB-{order.number}</p>
      <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.4rem)" }}>
        {order.status === "pending" ? (thanks?.heading ?? "Thank you, {name}!").replace(/\{name\}/g, first) : STATUS_LABEL[order.status]}
      </h1>
      <p className="zs-lede">
        {order.status === "pending"
          ? (thanks?.message ?? "Your order is with the shop. They will confirm it shortly — keep this page to follow it.")
          : "Keep this page to follow your order."}
      </p>
      <ol className="zs-steps">
        {order.events.map((e, i) => (
          <li key={i}>
            <div>
              <strong>{STATUS_LABEL[e.status] ?? e.note}</strong>
              {STATUS_LABEL[e.status] && e.note && e.note !== STATUS_LABEL[e.status] && <p className="zs-muted zs-small">{e.note}</p>}
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
                <td>
                  {l.quantity} × {l.name}
                  {l.variant && <span className="zs-muted"> ({l.variant})</span>}
                </td>
                <td>{inr(l.lineTotal)}</td>
              </tr>
            ))}
            {(order.discount > 0 || order.adjustments.length > 0) && (
              <tr>
                <td>Subtotal</td>
                <td>{inr(order.subtotal)}</td>
              </tr>
            )}
            {order.discounts.map((d) => (
              <tr key={d.id} className="zs-saving">
                <td>{d.code ? `${d.name} (${d.code})` : d.name}</td>
                <td>−{inr(d.amount)}</td>
              </tr>
            ))}
            {order.adjustments.map((a, i) => (
              <tr key={i}>
                <td>{a.label}</td>
                <td>{a.amount < 0 ? `−${inr(-a.amount)}` : inr(a.amount)}</td>
              </tr>
            ))}
            <tr>
              <td><strong>Total — pay on delivery</strong></td>
              <td>{inr(order.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
