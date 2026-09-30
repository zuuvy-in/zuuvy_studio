import { quoteCart } from "@zsite/platform";
import { Placeholder, SiteShell, SystemFrame, commerceOf } from "@zsite/runtime";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { chromeContext, currentCustomer, isStore, readCart, readCode } from "@/lib/shop";
import { currentSite } from "@/lib/site";
import { QuantityControl } from "./controls";
import { CodeForm, PluginMessages, Totals } from "./parts";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export default async function CartPage() {
  const current = await currentSite();
  if (!current || !isStore(current)) notFound();
  const [items, code, customer, ctx] = await Promise.all([readCart(), readCode(), currentCustomer(current), chromeContext(current)]);
  const quote = await quoteCart(current.resolved, items, { code, customerId: customer?.id, plugins: true });
  const pages = commerceOf(current.site.tree).pages;
  const more = pages.cart.continueLabel ?? "Continue shopping";
  return (
    <SiteShell tree={current.site.tree} ctx={ctx}>
      <SystemFrame pages={pages} wide>
        <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.4rem)" }}>{pages.cart.heading ?? "Your cart"}</h1>
        {!quote.lines.length ? (
          <div className="zs-card" style={{ marginTop: 24 }}>
            <p>{pages.cart.empty ?? "Your cart is empty."}</p>
            <a href="/" className="zs-btn zs-btn-primary">{more}</a>
          </div>
        ) : (
          <div className="zs-checkout" data-summary="side" style={{ marginTop: 24 }}>
            <ul className="zs-cart-lines">
              {quote.lines.map((l) => (
                <li key={l.productId} className="zs-cart-line">
                  {l.image ? <img src={l.image} alt="" /> : <Placeholder label={l.name} />}
                  <div>
                    <h3>{l.name}</h3>
                    {l.variant && <p className="zs-muted">{l.variant}</p>}
                    <p className="zs-muted">{inr(l.unitPrice)} each</p>
                    {l.problem && <p className="zs-muted" style={{ color: "#b91c1c" }}>{l.problem}</p>}
                    <QuantityControl productId={l.productId} quantity={l.quantity} max={l.max} back="/cart#" />
                  </div>
                  <strong>{inr(l.lineTotal)}</strong>
                </li>
              ))}
            </ul>
            <div className="zs-card zs-checkout-summary zs-form">
              <PluginMessages quote={quote} />
              <CodeForm code={code} quote={quote} />
              <Totals quote={quote} />
              {quote.ready ? (
                <a href="/checkout" className="zs-btn zs-btn-primary">Check out</a>
              ) : (
                <p className="zs-alert">Change or remove the items marked above to check out.</p>
              )}
              <a href="/" className="zs-btn zs-btn-ghost">{more}</a>
            </div>
          </div>
        )}
      </SystemFrame>
    </SiteShell>
  );
}
