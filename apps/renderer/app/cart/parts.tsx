import type { Quote } from "@zsite/platform";
import { applyCodeAction, removeCodeAction } from "./actions";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function Totals({ quote }: { quote: Quote }) {
  return (
    <table className="zs-totals">
      <tbody>
        <tr>
          <td>Subtotal</td>
          <td>{inr(quote.subtotal)}</td>
        </tr>
        {quote.discounts.map((d) => (
          <tr key={d.id} className="zs-saving">
            <td>{d.code ? `${d.name} (${d.code})` : d.name}</td>
            <td>−{inr(d.amount)}</td>
          </tr>
        ))}
        {quote.adjustments.map((a, i) => (
          <tr key={i} className={a.amount < 0 ? "zs-saving" : ""}>
            <td>{a.label}</td>
            <td>{a.amount < 0 ? `−${inr(-a.amount)}` : inr(a.amount)}</td>
          </tr>
        ))}
        <tr className="zs-grand">
          <td>Total — pay on delivery</td>
          <td>{inr(quote.total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function PluginMessages({ quote }: { quote: Quote }) {
  return quote.messages.map((m, i) => (
    <p key={i} className="zs-note" data-tone={m.tone}>
      {m.text}
    </p>
  ));
}

export function CodeForm({ code, quote }: { code: string | null; quote: Quote }) {
  return code ? (
    <div className="zs-note" data-tone={quote.codeApplied ? "success" : "warning"}>
      <strong>{code}</strong> — {quote.codeApplied ? "applied" : quote.codeMessage}{" "}
      <form action={removeCodeAction} style={{ display: "inline" }}>
        <button type="submit" className="zs-link-button">Remove</button>
      </form>
    </div>
  ) : (
    <form action={applyCodeAction} className="zs-form zs-inline-form">
      <input name="code" placeholder="Discount code" aria-label="Discount code" maxLength={30} />
      <button type="submit" className="zs-btn zs-btn-ghost zs-btn-sm">Apply</button>
    </form>
  );
}

