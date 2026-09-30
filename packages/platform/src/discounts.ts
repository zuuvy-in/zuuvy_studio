/**
 * Discounts: rules the business writes, applied to a cart.
 *
 * A discount without a code applies by itself when its rules hold; one with a
 * code applies when the customer enters it. Rules: which lines it counts (all,
 * or chosen products / groups / categories), a minimum spend and quantity on
 * those lines, dates, a total usage limit, once per customer, first order only,
 * and a cap on the amount.
 *
 * Only one discount applies unless a discount is marked `stacks`: of the rest,
 * the one worth most to the customer wins, and a code that loses to a better
 * automatic offer says so rather than silently doing nothing. Stacking
 * discounts are added on top. The total never goes below zero.
 *
 * Money is counted in paise here so no rounding creeps in.
 */
import { type Tx, UserError, isUuid } from "./db";

export type DiscountKind = "percent" | "fixed";
export type DiscountScope = "all" | "products" | "groups" | "categories";

export type Discount = {
  id: string;
  /** The store it applies in; null = every store. */
  site_id: string | null;
  name: string;
  code: string | null;
  kind: DiscountKind;
  value: number;
  scope: DiscountScope;
  scope_ids: string[];
  min_subtotal: number | null;
  min_quantity: number | null;
  max_amount: number | null;
  starts_at: Date | null;
  ends_at: Date | null;
  usage_limit: number | null;
  used_count: number;
  once_per_customer: boolean;
  first_order_only: boolean;
  stacks: boolean;
  active: boolean;
  created_at: Date;
};

const COLUMNS = `id, name, code, kind, value::float8 as value, scope, scope_ids, min_subtotal::float8 as min_subtotal,
  min_quantity, max_amount::float8 as max_amount, starts_at, ends_at, usage_limit, used_count, once_per_customer,
  first_order_only, stacks, active, created_at, site_id`;

/** A cart line as discounts see it. */
export type DiscountLine = { productId: string; groupId: string | null; category: string | null; quantity: number; lineTotal: number };

export type AppliedDiscount = { id: string; name: string; code: string | null; amount: number };

/** Who is buying, as far as the rules need to know. */
export type Buyer = { previousOrders: number; redeemed: Set<string> };

export type DiscountResult = {
  applied: AppliedDiscount[];
  total: number;
  /** What happened to the code the customer typed, in words; null when none was typed. */
  codeMessage: string | null;
  codeApplied: boolean;
};

const paise = (n: number) => Math.round(n * 100);
const rupees = (p: number) => p / 100;

/** Why a discount does not apply, or null when it does. */
function ineligible(d: Discount, lines: DiscountLine[], buyer: Buyer | null, now: Date): string | null {
  if (!d.active) return "This offer is not running.";
  if (d.starts_at && now < new Date(d.starts_at)) return "This offer has not started yet.";
  if (d.ends_at && now > new Date(d.ends_at)) return "This offer has ended.";
  if (d.usage_limit !== null && d.used_count >= d.usage_limit) return "This offer has run out.";
  const counted = scoped(d, lines);
  if (!counted.length) return "This offer does not cover anything in your cart.";
  const base = counted.reduce((n, l) => n + paise(l.lineTotal), 0);
  if (d.min_subtotal !== null && base < paise(d.min_subtotal)) return `Spend ₹${d.min_subtotal.toLocaleString("en-IN")} on eligible items to use this offer.`;
  if (d.min_quantity !== null && counted.reduce((n, l) => n + l.quantity, 0) < d.min_quantity) return `Add ${d.min_quantity} eligible items to use this offer.`;
  if (buyer) {
    if (d.first_order_only && buyer.previousOrders > 0) return "This offer is for a first order.";
    if (d.once_per_customer && buyer.redeemed.has(d.id)) return "You have already used this offer.";
  }
  return null;
}

function scoped(d: Discount, lines: DiscountLine[]): DiscountLine[] {
  const ids = new Set(d.scope_ids.map((x) => x.toLowerCase()));
  switch (d.scope) {
    case "all":
      return lines;
    case "products":
      return lines.filter((l) => ids.has(l.productId.toLowerCase()));
    case "groups":
      return lines.filter((l) => l.groupId !== null && ids.has(l.groupId.toLowerCase()));
    case "categories":
      return lines.filter((l) => l.category !== null && ids.has(l.category.toLowerCase()));
  }
}

function amountOf(d: Discount, lines: DiscountLine[]): number {
  const base = scoped(d, lines).reduce((n, l) => n + paise(l.lineTotal), 0);
  let amount = d.kind === "percent" ? Math.round((base * Math.min(d.value, 100)) / 100) : Math.min(paise(d.value), base);
  if (d.max_amount !== null) amount = Math.min(amount, paise(d.max_amount));
  return amount;
}

/**
 * Which discounts apply to these lines. `buyer` is null when nobody is known
 * yet (a cart before checkout): per-customer rules are then checked at
 * checkout, when the phone number or account is.
 */
export function applyDiscounts(
  discounts: Discount[],
  lines: DiscountLine[],
  opts: { code?: string | null; buyer?: Buyer | null; now?: Date } = {},
): DiscountResult {
  const now = opts.now ?? new Date();
  const buyer = opts.buyer ?? null;
  const code = opts.code?.trim().toUpperCase() || null;
  const subtotal = lines.reduce((n, l) => n + paise(l.lineTotal), 0);

  const typed = code ? discounts.find((d) => d.code?.toUpperCase() === code) ?? null : null;
  let codeMessage: string | null = code && !typed ? "That code is not valid." : null;
  const candidates = discounts.filter((d) => d.code === null || d === typed);

  const eligible: { d: Discount; amount: number }[] = [];
  for (const d of candidates) {
    const why = ineligible(d, lines, buyer, now);
    if (why) {
      if (d === typed) codeMessage = why;
      continue;
    }
    const amount = amountOf(d, lines);
    if (amount > 0) eligible.push({ d, amount });
  }

  const single = eligible.filter((e) => !e.d.stacks).sort((a, b) => b.amount - a.amount || (a.d.code ? -1 : 1))[0];
  const chosen = [...(single ? [single] : []), ...eligible.filter((e) => e.d.stacks)];
  let left = subtotal;
  const applied: AppliedDiscount[] = [];
  for (const c of chosen) {
    const amount = Math.min(c.amount, left);
    if (amount <= 0) continue;
    left -= amount;
    applied.push({ id: c.d.id, name: c.d.name, code: c.d.code, amount: rupees(amount) });
  }
  const codeApplied = Boolean(typed && applied.some((a) => a.id === typed.id));
  if (typed && !codeApplied && !codeMessage) codeMessage = "A better offer is already applied to this cart.";
  return { applied, total: rupees(subtotal - left), codeMessage, codeApplied };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export type DiscountInput = {
  name: string;
  code?: string | null;
  kind: string;
  value: number;
  scope?: string;
  scopeIds?: string[];
  minSubtotal?: number | null;
  minQuantity?: number | null;
  maxAmount?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  oncePerCustomer?: boolean;
  firstOrderOnly?: boolean;
  stacks?: boolean;
  active?: boolean;
};

function clean(input: DiscountInput) {
  const name = input.name.trim();
  if (!name) throw new UserError("Give the discount a name customers will see, like “Diwali 10% off”.");
  const code = input.code?.trim().toUpperCase() || null;
  if (code && !/^[A-Z0-9_-]{3,30}$/.test(code)) throw new UserError("A code is 3 to 30 letters, numbers, - or _.");
  if (input.kind !== "percent" && input.kind !== "fixed") throw new UserError("Choose a percentage or an amount off.");
  const value = Number(input.value);
  if (!(value > 0)) throw new UserError("How much off? Enter a number above zero.");
  if (input.kind === "percent" && value > 100) throw new UserError("A percentage cannot be over 100.");
  const scope = (input.scope ?? "all") as DiscountScope;
  if (!["all", "products", "groups", "categories"].includes(scope)) throw new UserError("Choose what the discount covers.");
  const scopeIds = (input.scopeIds ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 200);
  if (scope !== "all" && !scopeIds.length) throw new UserError("Choose at least one item the discount covers.");
  if ((scope === "products" || scope === "groups") && !scopeIds.every(isUuid)) throw new UserError("One of the chosen items does not exist.");
  const num = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? null : v);
  const date = (v: string | null | undefined) => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new UserError("One of the dates is not a date.");
    return d;
  };
  const startsAt = date(input.startsAt);
  const endsAt = date(input.endsAt);
  if (startsAt && endsAt && endsAt <= startsAt) throw new UserError("The end date is before the start.");
  const usageLimit = num(input.usageLimit);
  if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1)) throw new UserError("A usage limit is a whole number above zero.");
  return {
    name: name.slice(0, 80),
    code,
    kind: input.kind,
    value,
    scope,
    scopeIds,
    minSubtotal: num(input.minSubtotal),
    minQuantity: num(input.minQuantity),
    maxAmount: num(input.maxAmount),
    startsAt,
    endsAt,
    usageLimit,
    oncePerCustomer: Boolean(input.oncePerCustomer),
    firstOrderOnly: Boolean(input.firstOrderOnly),
    stacks: Boolean(input.stacks),
    active: input.active ?? true,
  };
}

const values = (d: ReturnType<typeof clean>) => [
  d.name, d.code, d.kind, d.value, d.scope, JSON.stringify(d.scopeIds), d.minSubtotal, d.minQuantity, d.maxAmount,
  d.startsAt, d.endsAt, d.usageLimit, d.oncePerCustomer, d.firstOrderOnly, d.stacks, d.active,
];

async function codeFree(tx: Tx, code: string | null, exceptId?: string) {
  if (!code) return;
  const clash = await tx.one("select 1 from discounts where upper(code) = $1 and id is distinct from $2", [code, exceptId ?? null]);
  if (clash) throw new UserError(`The code ${code} is already used by another discount.`);
}

export async function createDiscount(tx: Tx, input: DiscountInput & { siteId?: string | null }): Promise<Discount> {
  const d = clean(input);
  await codeFree(tx, d.code);
  return tx.get<Discount>(
    `insert into discounts (tenant_id, name, code, kind, value, scope, scope_ids, min_subtotal, min_quantity, max_amount,
                            starts_at, ends_at, usage_limit, once_per_customer, first_order_only, stacks, active, site_id)
     values (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) returning ${COLUMNS}`,
    [...values(d), input.siteId ?? null],
  );
}

export async function updateDiscount(tx: Tx, id: string, input: DiscountInput): Promise<Discount> {
  if (!isUuid(id)) throw new UserError("That discount does not exist.");
  const d = clean(input);
  await codeFree(tx, d.code, id);
  return tx.get<Discount>(
    `update discounts set name = $2, code = $3, kind = $4, value = $5, scope = $6, scope_ids = $7, min_subtotal = $8,
            min_quantity = $9, max_amount = $10, starts_at = $11, ends_at = $12, usage_limit = $13, once_per_customer = $14,
            first_order_only = $15, stacks = $16, active = $17, updated_at = now()
      where id = $1 returning ${COLUMNS}`,
    [id, ...values(d)],
    "discount",
  );
}

export async function deleteDiscount(tx: Tx, id: string): Promise<void> {
  if (!isUuid(id)) throw new UserError("That discount does not exist.");
  await tx.get("delete from discounts where id = $1 returning id", [id], "discount");
}

export async function listDiscounts(tx: Tx, siteId?: string): Promise<Discount[]> {
  return tx.query<Discount>(
    `select ${COLUMNS} from discounts ${siteId ? "where site_id is null or site_id = $1" : ""} order by active desc, created_at desc`,
    siteId ? [siteId] : [],
  );
}

export async function getDiscount(tx: Tx, id: string): Promise<Discount> {
  if (!isUuid(id)) throw new UserError("That discount does not exist.");
  return tx.get<Discount>(`select ${COLUMNS} from discounts where id = $1`, [id], "discount");
}

/** The discounts that could apply now; the rules themselves are checked per cart. */
export async function liveDiscounts(tx: Tx, siteId?: string | null): Promise<Discount[]> {
  return tx.query<Discount>(
    `select ${COLUMNS} from discounts where active and (ends_at is null or ends_at > now()) and (site_id is null or site_id = $1)`,
    [siteId ?? null],
  );
}

/** What the per-customer rules need: earlier orders and offers already used, by account or phone. */
export async function buyerHistory(tx: Tx, who: { customerId?: string | null; phone?: string | null }): Promise<Buyer> {
  if (!who.customerId && !who.phone) return { previousOrders: 0, redeemed: new Set() };
  const orders = await tx.get<{ n: number }>(
    `select count(*)::int as n from orders
      where status not in ('rejected', 'cancelled')
        and (($1::uuid is not null and customer_id = $1) or ($2::text is not null and customer->>'phone' = $2))`,
    [who.customerId ?? null, who.phone ?? null],
  );
  const used = await tx.query<{ discount_id: string }>(
    `select distinct discount_id from discount_redemptions
      where ($1::uuid is not null and customer_id = $1) or ($2::text is not null and phone = $2)`,
    [who.customerId ?? null, who.phone ?? null],
  );
  return { previousOrders: orders.n, redeemed: new Set(used.map((u) => u.discount_id)) };
}

/**
 * Record the discounts an order used. The usage count moves with a
 * conditional update, so the last use of a limited offer goes to one order.
 */
export async function redeemDiscounts(
  tx: Tx,
  orderId: string,
  applied: AppliedDiscount[],
  who: { customerId?: string | null; phone?: string | null },
): Promise<void> {
  for (const a of applied) {
    const ok = await tx.one(
      "update discounts set used_count = used_count + 1 where id = $1 and (usage_limit is null or used_count < usage_limit) returning id",
      [a.id],
    );
    if (!ok) throw new UserError(`${a.name} has just run out. Your cart has been updated — please check the total.`);
    await tx.query(
      "insert into discount_redemptions (discount_id, order_id, tenant_id, customer_id, phone, amount) values ($1, $2, app_tenant(), $3, $4, $5)",
      [a.id, orderId, who.customerId ?? null, who.phone ?? null, a.amount],
    );
  }
}
