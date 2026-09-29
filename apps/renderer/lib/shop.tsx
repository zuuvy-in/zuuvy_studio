import "server-only";
import {
  type CartItem,
  type CustomerAccount,
  type Quote,
  customerFromSession,
  parseCart,
  quoteCart,
  serialiseCart,
} from "@zsite/platform";
import { Placeholder, type ProductView, type RenderContext, commerceOf, linkRewriter } from "@zsite/runtime";
import { cookies } from "next/headers";
import { cache } from "react";
import { AddToCart } from "@/app/cart/controls";
import { type Current, liveContext } from "./site";

/**
 * The shopper's side of a store: a cart and, optionally, an account. Both
 * live in cookies on the store's own host — the cart as a short list of ids
 * and quantities (prices are always worked out again on the server), the
 * account as a session token.
 */
export const CART_COOKIE = "zs_cart";
export const CODE_COOKIE = "zs_code";
export const CUSTOMER_COOKIE = "zs_customer";

const cookieOptions = (days: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: days * 86400,
});

export async function readCart(): Promise<CartItem[]> {
  return parseCart((await cookies()).get(CART_COOKIE)?.value);
}

/** Only from a server action or route handler. */
export async function writeCart(items: CartItem[]): Promise<void> {
  const jar = await cookies();
  if (items.length) jar.set(CART_COOKIE, serialiseCart(items), cookieOptions(30));
  else jar.delete(CART_COOKIE);
}

export async function readCode(): Promise<string | null> {
  return (await cookies()).get(CODE_COOKIE)?.value || null;
}

export async function writeCode(code: string | null): Promise<void> {
  const jar = await cookies();
  if (code) jar.set(CODE_COOKIE, code.slice(0, 30), cookieOptions(7));
  else jar.delete(CODE_COOKIE);
}

export async function setCustomerCookie(token: string, expires: Date): Promise<void> {
  (await cookies()).set(CUSTOMER_COOKIE, token, { ...cookieOptions(60), maxAge: undefined, expires });
}

export async function customerToken(): Promise<string | undefined> {
  return (await cookies()).get(CUSTOMER_COOKIE)?.value;
}

/** The signed-in customer of this store's business, once per request. */
export const currentCustomer = cache(async (current: Current): Promise<CustomerAccount | null> => {
  return customerFromSession(current.resolved.tenantId, await customerToken());
});

export const isStore = (current: Current) => current.site.site.kind === "store";
/** Whether visitors can sign in here: every store, and any site whose owner switched accounts on. */
export const hasAccounts = (current: Current) => isStore(current) || current.site.site.accounts;

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** A quick look at the cart for the header and drawer: no plugins, no code — those are the cart page's. */
export const glance = cache(async (current: Current): Promise<Quote | null> => {
  const items = await readCart();
  if (!items.length) return null;
  const customer = await currentCustomer(current);
  return quoteCart(current.resolved, items, { customerId: customer?.id });
});

export function CartSummaryLines({ quote }: { quote: Quote }) {
  return (
    <ul className="zs-cart-lines">
      {quote.lines.map((l) => (
        <li key={l.productId} className="zs-cart-line">
          {l.image ? <img src={l.image} alt="" /> : <Placeholder label={l.name} />}
          <div>
            <h3>{l.name}</h3>
            {l.variant && <p className="zs-muted">{l.variant}</p>}
            <p className="zs-muted">
              {l.quantity} × {inr(l.unitPrice)}
            </p>
            {l.problem && <p className="zs-muted" style={{ color: "#b91c1c" }}>{l.problem}</p>}
          </div>
          <strong>{inr(l.lineTotal)}</strong>
        </li>
      ))}
    </ul>
  );
}

function Drawer({ quote, empty }: { quote: Quote | null; empty?: string }) {
  if (!quote || !quote.lines.length) return <p className="zs-muted">{empty ?? "Your cart is empty."}</p>;
  return (
    <>
      <CartSummaryLines quote={quote} />
      <table className="zs-totals">
        <tbody>
          {quote.discount > 0 && (
            <tr className="zs-saving">
              <td>{quote.discounts.map((d) => d.name).join(", ")}</td>
              <td>−{inr(quote.discount)}</td>
            </tr>
          )}
          <tr className="zs-grand">
            <td>Total</td>
            <td>{inr(quote.total)}</td>
          </tr>
        </tbody>
      </table>
      <a href="/checkout" className="zs-btn zs-btn-primary">Check out</a>
      <a href="/cart" className="zs-btn zs-btn-ghost">View cart</a>
    </>
  );
}

/**
 * The page context for a store: products, links for variant groups, the
 * cart and account in the header, and quick-add buttons if the design wants them.
 */
export type PageQuery = { path?: string; cart?: string; form?: string; sent?: string; error?: string };

export async function shopContext(current: Current, page: PageQuery = {}): Promise<RenderContext> {
  const base: RenderContext = {
    ...(await liveContext(current)),
    forms: {
      action: "/api/form",
      page: page.path ?? "/",
      renderedAt: Date.now(),
      ...(page.form ? { status: { section: page.form, ...(page.sent ? { ok: "1" } : {}), ...(page.error ? { error: page.error } : {}) } } : {}),
    },
  };
  if (!hasAccounts(current)) return base;
  const c = commerceOf(current.site.tree);
  if (!isStore(current)) {
    // Accounts without a shop: a sign-in link in the header, and never a cart.
    const customer = await currentCustomer(current);
    return { ...base, shop: { cart: false, accounts: true, cartCount: 0, signedIn: customer ? customer.name.split(" ")[0]! : null } };
  }
  const [quote, customer] = await Promise.all([glance(current), currentCustomer(current)]);
  return {
    ...base,
    groupHref: (id) => `/g/${id}`,
    shop: {
      cart: true,
      accounts: true,
      cartCount: quote?.count ?? 0,
      signedIn: customer ? customer.name.split(" ")[0]! : null,
      drawer: c.cart.style === "drawer" ? <Drawer quote={quote} empty={c.pages.cart.empty} /> : undefined,
      drawerOpen: page.cart === "open" && c.cart.style === "drawer",
      closeHref: page.path ?? "#",
    },
    cardAction: c.buy === "buy_now" ? undefined : (p: ProductView) => (p.inStock || p.backorders ? <AddToCart productId={p.id} compact back={page.path ?? "/"} /> : null),
  };
}

/** Pages outside the tree (cart, checkout, account) still get the store's header and cart. */
export async function chromeContext(current: Current, page: PageQuery = {}): Promise<RenderContext> {
  const ctx = await shopContext(current, page);
  return { ...ctx, href: linkRewriter(""), products: [] };
}
