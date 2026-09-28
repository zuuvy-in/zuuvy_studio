/**
 * The cart and checkout, server side. The cart itself is a short list of
 * product ids and quantities kept by the store (in a cookie); everything
 * about money is worked out here, every time, from the catalogue as it is:
 * prices, what this store may sell, stock, discounts and what plugins add.
 *
 * `quoteCart` is what the cart page shows. `checkout` quotes again, asks
 * plugins whether the order may go ahead, and places it — the order's own
 * transaction then decides the discounts once more from the rules as they
 * stand at that moment, so a cart left open overnight cannot keep an offer
 * that has ended.
 */
import { type Product, getProducts } from "./catalog";
import { type AppliedDiscount, applyDiscounts, buyerHistory, liveDiscounts } from "./discounts";
import { UserError, isUuid, withTenant } from "./db";
import { groupSummaries, variantLabel } from "./groups";
import { sellsOutOfStock, siteInventory, sourcesFor, tracksStock } from "./inventory";
import { type Customer, normalisePhone, placeOrder } from "./orders";
import {
  type Adjustment,
  type CheckoutField,
  type PluginMessage,
  calculateHooks,
  checkoutFields,
  readFieldAnswers,
  validateHooks,
} from "./plugins";
import { type ResolvedSite, asSold } from "./storefront";

export type CartItem = { productId: string; quantity: number };

export const MAX_LINES = 30;
export const MAX_QUANTITY = 99;

/** A cart from wherever the store kept it: bad entries are dropped, duplicates merged. */
export function parseCart(raw: string | undefined | null): CartItem[] {
  let list: unknown;
  try {
    list = JSON.parse(raw || "[]");
  } catch {
    return [];
  }
  const merged = new Map<string, number>();
  for (const item of Array.isArray(list) ? list : []) {
    const id = (item as { p?: unknown }).p;
    const q = Number((item as { q?: unknown }).q);
    if (typeof id !== "string" || !isUuid(id) || !Number.isInteger(q) || q < 1) continue;
    merged.set(id, Math.min(MAX_QUANTITY, (merged.get(id) ?? 0) + q));
  }
  return [...merged].slice(0, MAX_LINES).map(([productId, quantity]) => ({ productId, quantity }));
}

export function serialiseCart(items: CartItem[]): string {
  return JSON.stringify(items.slice(0, MAX_LINES).map((i) => ({ p: i.productId, q: i.quantity })));
}

/** Add, change (0 removes) or replace one line. */
export function updateCart(items: CartItem[], productId: string, quantity: number, mode: "add" | "set"): CartItem[] {
  if (!isUuid(productId)) return items;
  const q = Math.max(0, Math.min(MAX_QUANTITY, Math.floor(quantity)));
  const next = items.map((i) => ({ ...i }));
  const line = next.find((i) => i.productId === productId);
  if (line) line.quantity = mode === "add" ? Math.min(MAX_QUANTITY, line.quantity + q) : q;
  else if (q > 0) {
    if (next.length >= MAX_LINES) throw new UserError(`A cart can hold ${MAX_LINES} different items.`);
    next.push({ productId, quantity: q });
  }
  return next.filter((i) => i.quantity > 0);
}

export type QuoteLine = {
  productId: string;
  name: string;
  variant: string | null;
  image: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  groupId: string | null;
  category: string | null;
  /** Most that can be ordered now; null = no limit beyond the cart's own. */
  max: number | null;
  /** Why this line cannot be ordered as it is; null when it can. */
  problem: string | null;
};

export type Quote = {
  lines: QuoteLine[];
  subtotal: number;
  discounts: AppliedDiscount[];
  discount: number;
  adjustments: Adjustment[];
  messages: PluginMessage[];
  fields: CheckoutField[];
  total: number;
  count: number;
  codeMessage: string | null;
  codeApplied: boolean;
  /** True when every line can be ordered as it stands. */
  ready: boolean;
};

const paise = (n: number) => Math.round(n * 100);

function lineFor(p: Product | undefined, item: CartItem, check: { allowed: string[]; counted: boolean; beyond: boolean }, variant: string | null, groupImage: string | null): QuoteLine | null {
  if (!p) return null;
  const available = p.active && p.price !== null && check.allowed.includes(p.source);
  const price = p.price ?? 0;
  let problem: string | null = available ? null : "No longer available";
  let max: number | null = null;
  if (available && check.counted && !check.beyond) {
    if (!p.in_stock) problem = "Out of stock";
    else if (p.stock !== null) {
      max = Math.max(0, Math.floor(p.stock));
      if (item.quantity > max) problem = `Only ${max} left`;
    }
  }
  return {
    productId: p.id,
    name: p.name,
    variant,
    image: p.images[0] ?? groupImage,
    unitPrice: price,
    quantity: item.quantity,
    lineTotal: (paise(price) * item.quantity) / 100,
    groupId: p.group_id,
    category: p.category,
    max,
    problem,
  };
}

export type QuoteOptions = {
  code?: string | null;
  customerId?: string | null;
  phone?: string | null;
  /** Ask plugins (cart.calculate); off for the header's count. */
  plugins?: boolean;
  /** Ask plugins for checkout questions (checkout.fields). */
  fields?: boolean;
};

export async function quoteCart(r: ResolvedSite, items: CartItem[], opts: QuoteOptions = {}): Promise<Quote> {
  const base = await withTenant(r.tenantId, async (tx) => {
    const inv = await siteInventory(tx, r.siteId);
    const allowed = sourcesFor(inv) ?? [];
    const check = { allowed, counted: tracksStock(inv), beyond: sellsOutOfStock(inv) };
    const products = await getProducts(tx, items.map((i) => i.productId));
    const byId = new Map(products.map((p) => [p.id, asSold(p, inv) ?? { ...p, active: false }]));
    const groups = await groupSummaries(tx, products.flatMap((p) => (p.group_id ? [p.group_id] : [])));
    const lines = items
      .map((i) => {
        const p = byId.get(i.productId);
        const g = p?.group_id ? groups.get(p.group_id) : undefined;
        const line = lineFor(p, i, check, g ? variantLabel(g.options, p!.options) || null : null, g?.images[0] ?? null);
        // A variant is shown as its group plus its options: "Linen shirt" · "Olive / L".
        return line && g && line.variant ? { ...line, name: g.name } : line;
      })
      .filter((l): l is QuoteLine => l !== null);
    const buyer = opts.customerId || opts.phone ? await buyerHistory(tx, { customerId: opts.customerId, phone: opts.phone }) : null;
    const sellable = lines.filter((l) => !l.problem);
    const priced = applyDiscounts(await liveDiscounts(tx), sellable, { code: opts.code, buyer });
    return { lines, sellable, priced };
  });

  const subtotal = base.sellable.reduce((n, l) => n + paise(l.lineTotal), 0) / 100;
  const payload = {
    site: r.siteId,
    cart: {
      lines: base.sellable.map((l) => ({ productId: l.productId, name: l.name, variant: l.variant, unitPrice: l.unitPrice, quantity: l.quantity, lineTotal: l.lineTotal })),
      subtotal,
      discount: base.priced.total,
    },
    customer: opts.customerId ? { id: opts.customerId } : null,
  };
  const hooks = opts.plugins && base.sellable.length ? await calculateHooks(r.tenantId, payload, subtotal) : { adjustments: [], messages: [] };
  const fields = opts.fields && base.sellable.length ? await checkoutFields(r.tenantId, payload) : [];
  const total = Math.max(0, paise(subtotal) - paise(base.priced.total) + hooks.adjustments.reduce((n, a) => n + paise(a.amount), 0)) / 100;
  return {
    lines: base.lines,
    subtotal,
    discounts: base.priced.applied,
    discount: base.priced.total,
    adjustments: hooks.adjustments,
    messages: hooks.messages,
    fields,
    total,
    count: base.lines.reduce((n, l) => n + l.quantity, 0),
    codeMessage: base.priced.codeMessage,
    codeApplied: base.priced.codeApplied,
    ready: base.lines.length > 0 && base.lines.every((l) => !l.problem),
  };
}

export type CheckoutInput = {
  items: CartItem[];
  customer: Customer;
  note?: string;
  code?: string | null;
  customerId?: string | null;
  /** The form's other fields, for plugin questions (x_<name>). */
  field: (name: string) => string;
};

/** Quote, let plugins have their say, and place the order. */
export async function checkout(r: ResolvedSite, input: CheckoutInput): Promise<{ id: string; number: number; publicToken: string }> {
  if (!input.items.length) throw new UserError("Your cart is empty.");
  const phone = normalisePhone(input.customer.phone);
  const quote = await quoteCart(r, input.items, { code: input.code, customerId: input.customerId, phone, plugins: true, fields: true });
  if (!quote.ready) throw new UserError("Some items in your cart cannot be ordered as they are. Please check your cart.");
  const extra = readFieldAnswers(quote.fields, input.field);
  const refusal = await validateHooks(r.tenantId, {
    site: r.siteId,
    cart: { lines: quote.lines, subtotal: quote.subtotal, discount: quote.discount, total: quote.total },
    customer: { name: input.customer.name, phone, address: input.customer.address },
    extra,
  });
  if (refusal) throw new UserError(refusal);
  return placeOrder(r.tenantId, {
    siteId: r.siteId,
    lines: input.items,
    customer: input.customer,
    note: input.note,
    customerId: input.customerId,
    discountCode: input.code,
    adjustments: quote.adjustments,
    extra,
  });
}

/** Where to send a shopper back to: a path on this store, never another site. */
export function commerceSafeBack(raw: string): string {
  const path = raw.split("#")[0]!.trim();
  return /^\/(?!\/)[^\\\s]*$/.test(path) && path.length < 300 ? path : "/";
}
