import { quoteCart } from "@zsite/platform";
import { SiteShell, commerceOf } from "@zsite/runtime";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CodeForm, PluginMessages, Totals } from "@/app/cart/parts";
import { CartSummaryLines, chromeContext, currentCustomer, isStore, readCart, readCode } from "@/lib/shop";
import { currentSite } from "@/lib/site";
import { CheckoutForm } from "./form";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  const current = await currentSite();
  if (!current || !isStore(current)) notFound();
  const items = await readCart();
  if (!items.length) redirect("/cart");
  const [code, customer, ctx] = await Promise.all([readCode(), currentCustomer(current), chromeContext(current)]);
  const quote = await quoteCart(current.resolved, items, { code, customerId: customer?.id, phone: customer?.phone, plugins: true, fields: true });
  if (!quote.ready) redirect("/cart");
  const c = commerceOf(current.site.tree);
  const summary = (
    <aside className="zs-card zs-checkout-summary zs-form">
      <h2 style={{ fontSize: "1.2rem", margin: 0 }}>Your order</h2>
      <CartSummaryLines quote={quote} />
      <PluginMessages quote={quote} />
      <CodeForm code={code} quote={quote} />
      <Totals quote={quote} />
      <a href="/cart" className="zs-link-button">Edit cart</a>
    </aside>
  );
  return (
    <SiteShell tree={current.site.tree} ctx={ctx}>
      <div className="zs-container zs-page">
        <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.4rem)" }}>{c.checkout.heading ?? "Checkout"}</h1>
        {!customer && c.account.show && (
          <p className="zs-muted">
            Have an account? <a href="/account?next=/checkout">Sign in</a> to use your saved details and follow this order later.
          </p>
        )}
        <div className="zs-checkout" data-summary={c.checkout.summary} data-layout={c.checkout.layout} style={{ marginTop: 24 }}>
          {c.checkout.summary === "top" && summary}
          <CheckoutForm
            layout={c.checkout.layout}
            askNote={c.checkout.askNote}
            reassurance={c.checkout.reassurance ?? null}
            total={quote.total}
            fields={quote.fields}
            defaults={{ name: customer?.name ?? "", phone: customer?.phone ?? "", address: customer?.address ?? "" }}
          />
          {c.checkout.summary === "side" && summary}
        </div>
      </div>
    </SiteShell>
  );
}
