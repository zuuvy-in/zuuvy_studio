/**
 * Orders placed on a storefront.
 *
 * An order is written here first, always — the customer gets an order number
 * whether or not Zuuvy is reachable — and sent to Zuuvy through the outbox.
 * From then on Zuuvy is the authority on its progress: its webhooks move the
 * status, and this side only refuses to move *backwards* (webhooks can arrive
 * out of order).
 *
 * Money is added up in paise, as integers; a rupee amount is only formed for
 * storage and display.
 */
import { getAlerts, orderAlertEmail, queueEmail } from "./email";
import { sellsOutOfStock, siteInventory, sourcesFor, tracksStock } from "./inventory";
import { ConnectorError, type OrderStatus, type OutboundOrder } from "@zsite/connectors";
import { getProducts } from "./catalog";
import { type AppliedDiscount, applyDiscounts, buyerHistory, liveDiscounts, redeemDiscounts } from "./discounts";
import { groupSummaries, variantLabel } from "./groups";
import { type Adjustment, orderPlacedPlugins } from "./plugins";
import { type Tx, UserError, isUuid, withTenant } from "./db";
import { getIntegration, loadConnection, logEvent } from "./integrations";
import { PermanentError, enqueue } from "./outbox";
import { randomToken } from "./secrets";

export type OrderLine = {
  productId: string;
  source: "native" | "zuuvy";
  externalId: string | null;
  name: string;
  image: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /** "Red / M / Slim" for a variant of a group. */
  variant?: string | null;
};

export type Customer = { name: string; phone: string; address: string };

export type Order = {
  id: string;
  site_id: string | null;
  number: number;
  public_token: string;
  status: OrderStatus;
  payment_method: "cod" | "online";
  payment_status: "unpaid" | "paid" | "refunded";
  customer: Customer;
  lines: OrderLine[];
  subtotal: number;
  discount: number;
  discounts: AppliedDiscount[];
  adjustments: Adjustment[];
  extra: Record<string, string | boolean>;
  customer_id: string | null;
  total: number;
  currency: string;
  note: string | null;
  external_ref: string | null;
  external_status: string | null;
  sync_state: "not_linked" | "pending" | "sent" | "failed";
  sync_error: string | null;
  created_at: Date;
  updated_at: Date;
};

export type OrderEvent = { id: number; status: string; note: string; source: string; created_at: Date };

const ORDER_COLUMNS = `id, site_id, number, public_token, status, payment_method, payment_status, customer, lines,
  subtotal, discount, discounts, adjustments, extra, customer_id, total, currency, note, external_ref, external_status,
  sync_state, sync_error, created_at, updated_at`;

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Waiting for confirmation",
  confirmed: "Confirmed",
  rejected: "Declined",
  packed: "Packed",
  shipped: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Forward-only progress. Terminal states outrank everything but delivery. */
const RANK: Record<OrderStatus, number> = {
  pending: 0,
  confirmed: 1,
  packed: 2,
  shipped: 3,
  delivered: 4,
  rejected: 5,
  cancelled: 5,
};

export const orderReference = (number: number) => `WEB-${number}`;

const paise = (rupees: number) => Math.round(rupees * 100);
const rupees = (p: number) => p / 100;

export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export type PlaceOrderInput = {
  siteId: string;
  lines: { productId: string; quantity: number }[];
  customer: Customer;
  note?: string;
  /** Signed-in customer placing it; their account then lists it. */
  customerId?: string | null;
  /** A discount code the customer entered. Automatic discounts apply regardless. */
  discountCode?: string | null;
  /** From plugins (cart.calculate), computed just before; bounded here again. */
  adjustments?: Adjustment[];
  /** Answers to plugin questions (checkout.fields). */
  extra?: Record<string, string | boolean>;
};

export async function placeOrder(tenantId: string, input: PlaceOrderInput): Promise<{ id: string; number: number; publicToken: string }> {
  const name = input.customer.name.trim();
  const phone = normalisePhone(input.customer.phone);
  const address = input.customer.address.trim();
  if (!name) throw new UserError("Please enter your name.");
  if (!phone) throw new UserError("Please enter a 10-digit mobile number.");
  if (address.length < 8) throw new UserError("Please enter your full delivery address.");
  const wanted = input.lines.filter((l) => l.quantity > 0);
  if (!wanted.length) throw new UserError("Your order is empty.");
  if (wanted.length > 30) throw new UserError("That is too many different items for one order.");
  for (const l of wanted) {
    if (!isUuid(l.productId) || !Number.isInteger(l.quantity) || l.quantity > 99) {
      throw new UserError("One of the quantities is not valid.");
    }
  }

  return withTenant(tenantId, async (tx) => {
    const found = await getProducts(tx, wanted.map((l) => l.productId));
    const products = new Map(found.map((p) => [p.id, p]));
    const groups = await groupSummaries(tx, found.flatMap((p) => (p.group_id ? [p.group_id] : [])));
    const inv = input.siteId ? await siteInventory(tx, input.siteId).catch(() => null) : null;
    const allowed = inv ? sourcesFor(inv) : null;
    if (inv && !allowed) throw new UserError("This site does not take orders.");
    // A store selling out-of-stock products takes the order; accepting takes what stock there is.
    const counted = (!inv || tracksStock(inv)) && !(inv && sellsOutOfStock(inv));
    const lines: OrderLine[] = [];
    let subtotal = 0;
    for (const l of wanted) {
      const p = products.get(l.productId);
      if (!p || !p.active || p.price === null || (allowed && !allowed.includes(p.source))) {
        throw new UserError("One of the products is no longer available.");
      }
      if (counted && !p.in_stock) throw new UserError(`${p.name} is out of stock.`);
      if (counted && p.stock !== null && l.quantity > p.stock) {
        throw new UserError(`Only ${p.stock} of ${p.name} ${p.stock === 1 ? "is" : "are"} left.`);
      }
      const line = paise(p.price) * l.quantity;
      subtotal += line;
      const group = p.group_id ? groups.get(p.group_id) : undefined;
      const variant = group ? variantLabel(group.options, p.options) || null : null;
      lines.push({
        productId: p.id,
        source: p.source,
        externalId: p.external_id,
        // A variant reads as its group and its options, not the product's own (often generated) name.
        name: group && variant ? group.name : p.name,
        image: p.images[0] ?? group?.images[0] ?? null,
        unitPrice: p.price,
        quantity: l.quantity,
        lineTotal: rupees(line),
        variant,
      });
    }
    // One order is fulfilled by one system. Mixing a Zuuvy product with a
    // native one would leave half the order with nobody to deliver it.
    const sources = new Set(lines.map((l) => l.source));
    if (sources.size > 1) throw new UserError("Some of these products are delivered separately; please order them separately.");

    const zuuvy = sources.has("zuuvy") ? await getIntegration(tx, "zuuvy") : null;
    const linked = zuuvy !== null && zuuvy.status !== "disconnected";

    // Discounts are decided here, in the order's own transaction, from the rules as they stand now.
    const customerId = input.customerId && isUuid(input.customerId) ? input.customerId : null;
    const buyer = await buyerHistory(tx, { customerId, phone });
    const priced = applyDiscounts(
      await liveDiscounts(tx),
      lines.map((l) => ({
        productId: l.productId,
        groupId: products.get(l.productId)?.group_id ?? null,
        category: products.get(l.productId)?.category ?? null,
        quantity: l.quantity,
        lineTotal: l.lineTotal,
      })),
      { code: input.discountCode, buyer },
    );
    if (input.discountCode?.trim() && !priced.codeApplied && priced.codeMessage !== "A better offer is already applied to this cart.") {
      throw new UserError(priced.codeMessage ?? "That code cannot be used on this order.");
    }
    const discount = paise(priced.total);
    const adjustments = (input.adjustments ?? []).slice(0, 10).map((a) => ({
      plugin: a.plugin.slice(0, 60),
      label: a.label.slice(0, 60),
      amount: Math.max(-rupees(subtotal), Math.min(rupees(subtotal), Math.round(a.amount * 100) / 100)),
    }));
    const total = Math.max(0, subtotal - discount + adjustments.reduce((n, a) => n + paise(a.amount), 0));

    const seq = await tx.get<{ n: number }>(
      "update tenants set order_seq = order_seq + 1 where id = app_tenant() returning order_seq as n",
    );
    const publicToken = randomToken(18);
    const order = await tx.get<{ id: string }>(
      `insert into orders (tenant_id, site_id, number, public_token, payment_method, customer, lines,
                           subtotal, discount, discounts, adjustments, extra, customer_id, total, note, sync_state)
       values (app_tenant(), $1, $2, $3, 'cod', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
      [input.siteId, seq.n, publicToken, JSON.stringify({ name, phone, address }), JSON.stringify(lines),
        rupees(subtotal), rupees(discount), JSON.stringify(priced.applied), JSON.stringify(adjustments),
        JSON.stringify(input.extra ?? {}), customerId, rupees(total),
        input.note?.trim().slice(0, 500) || null, linked ? "pending" : "not_linked"],
    );
    await redeemDiscounts(tx, order.id, priced.applied, { customerId, phone });
    for (const pluginId of await orderPlacedPlugins(tx)) await enqueue(tx, "plugin.notify", { pluginId, orderId: order.id });
    await addOrderEvent(tx, order.id, "pending", "Order placed — cash on delivery", "storefront");
    // Alerts go in the same transaction: no order without its alert, no alert for an order that rolled back.
    const alerts = await getAlerts(tx);
    if (alerts.orders && alerts.emails.length) {
      const business = (await tx.one<{ name: string }>("select name from tenants where id = app_tenant()"))?.name ?? "your store";
      for (const to of alerts.emails) {
        await queueEmail(
          tx,
          orderAlertEmail(to, {
            number: seq.n,
            business,
            total: rupees(total),
            customer: name,
            items: lines.map((l) => `${l.quantity} × ${l.name}`),
            orderId: order.id,
          }),
        );
      }
    }
    if (linked) await enqueue(tx, "order.push", { orderId: order.id, kind: "zuuvy" });
    return { id: order.id, number: seq.n, publicToken };
  });
}

export async function addOrderEvent(tx: Tx, orderId: string, status: string, note: string, source: string): Promise<void> {
  await tx.query(
    "insert into order_events (tenant_id, order_id, status, note, source) values (app_tenant(), $1, $2, $3, $4)",
    [orderId, status, note, source],
  );
}

export async function listOrders(tx: Tx, opts: { status?: string; limit?: number } = {}): Promise<Order[]> {
  const params: unknown[] = [];
  let where = "";
  if (opts.status) {
    params.push(opts.status);
    where = `where status = $1`;
  }
  params.push(opts.limit ?? 100);
  return tx.query<Order>(`select ${ORDER_COLUMNS} from orders ${where} order by created_at desc limit $${params.length}`, params);
}

export async function getOrder(tx: Tx, orderId: string): Promise<Order & { events: OrderEvent[] }> {
  const order = await tx.get<Order>(`select ${ORDER_COLUMNS} from orders where id = $1`, [orderId], "order");
  const events = await tx.query<OrderEvent>(
    "select id, status, note, source, created_at from order_events where order_id = $1 order by id",
    [orderId],
  );
  return { ...order, events };
}

/**
 * Move an order to what the fulfilling system says. Returns whether anything
 * changed; a status that would move the order backwards is ignored.
 */
export async function applyOrderStatus(
  tx: Tx,
  orderId: string,
  status: OrderStatus,
  external: { ref?: string; status?: string; note?: string; source: string },
): Promise<{ applied: boolean; reason?: string }> {
  const order = await tx.one<{ status: OrderStatus }>("select status from orders where id = $1 for update", [orderId]);
  if (!order) return { applied: false, reason: "no such order" };
  const moves = order.status !== status && RANK[status] > RANK[order.status] && order.status !== "delivered";
  await tx.query(
    `update orders set external_ref = coalesce($2, external_ref), external_status = coalesce($3, external_status),
       status = case when $4 then $5 else status end, updated_at = now() where id = $1`,
    [orderId, external.ref ?? null, external.status ?? null, moves, status],
  );
  if (!moves) return { applied: false, reason: `already ${order.status}` };
  await addOrderEvent(tx, orderId, status, external.note ?? STATUS_LABELS[status], external.source);
  return { applied: true };
}

export async function retryOrderSync(tenantId: string, orderId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const o = await tx.get<{ sync_state: string }>("select sync_state from orders where id = $1", [orderId], "order");
    if (o.sync_state === "sent") throw new UserError("This order has already reached Zuuvy.");
    const linked = await getIntegration(tx, "zuuvy");
    if (!linked || linked.status === "disconnected") throw new UserError("Connect Zuuvy first.");
    await tx.query("update orders set sync_state = 'pending', sync_error = null, updated_at = now() where id = $1", [orderId]);
    await enqueue(tx, "order.push", { orderId, kind: "zuuvy" });
  });
}

/** Outbox handler: send one order to the fulfilling system. Safe to repeat. */
export async function pushOrder(tenantId: string, orderId: string, kind = "zuuvy"): Promise<void> {
  const prepared = await withTenant(tenantId, async (tx) => {
    const order = await tx.one<Order>(`select ${ORDER_COLUMNS} from orders where id = $1`, [orderId]);
    if (!order || order.sync_state === "sent") return null;
    const loaded = await loadConnection(tx, kind);
    if (!loaded) throw new PermanentError("Zuuvy is not connected");
    return { order, loaded };
  });
  if (!prepared) return;
  const { order, loaded } = prepared;
  if (!loaded.connector.pushOrder) throw new PermanentError(`${loaded.connector.name} does not take orders`);

  const outbound: OutboundOrder = {
    requestId: order.id,
    reference: orderReference(order.number),
    customer: order.customer,
    lines: order.lines.map((l) => {
      if (!l.externalId) throw new PermanentError(`${l.name} has no Zuuvy id`);
      return { externalProductId: l.externalId, name: l.variant ? `${l.name} (${l.variant})` : l.name, quantity: l.quantity, unitPrice: l.unitPrice };
    }),
    payment: { method: order.payment_method, status: order.payment_status === "paid" ? "paid" : "unpaid" },
    subtotal: order.subtotal,
    total: order.total,
    // Zuuvy's order has no discount field: the total carries it, and the note says why.
    ...(order.note || order.discount || order.adjustments.length
      ? {
          note: [
            order.note,
            order.discount ? `Discount ₹${order.discount} (${order.discounts.map((d) => d.code ?? d.name).join(", ")})` : "",
            ...order.adjustments.map((a) => `${a.label}: ₹${a.amount}`),
          ]
            .filter(Boolean)
            .join(" · "),
        }
      : {}),
  };

  try {
    const res = await loaded.connector.pushOrder(loaded.conn, outbound);
    await withTenant(tenantId, async (tx) => {
      await tx.query("update orders set sync_state = 'sent', sync_error = null, updated_at = now() where id = $1", [orderId]);
      await addOrderEvent(tx, orderId, "sent", `Sent to Zuuvy as order #${res.externalOrderId}`, "platform");
      await applyOrderStatus(tx, orderId, res.status, { ref: res.externalOrderId, status: res.externalStatus, source: "zuuvy" });
      await logEvent(tx, loaded.integration.id, {
        direction: "out",
        topic: "order.push",
        status: "ok",
        summary: `${orderReference(order.number)} → Zuuvy #${res.externalOrderId} (${res.externalStatus})`,
      });
    });
  } catch (e) {
    const message = (e as Error).message;
    await withTenant(tenantId, async (tx) => {
      await tx.query("update orders set sync_error = $2, updated_at = now() where id = $1", [orderId, message]);
      await logEvent(tx, loaded.integration.id, {
        direction: "out",
        topic: "order.push",
        status: "error",
        summary: `${orderReference(order.number)}: ${message}`,
      });
    });
    if (e instanceof ConnectorError && !e.retryable) throw new PermanentError(message);
    throw e;
  }
}

export async function markOrderSyncFailed(tenantId: string, orderId: string, message: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx.query("update orders set sync_state = 'failed', sync_error = $2, updated_at = now() where id = $1", [orderId, message]);
    await addOrderEvent(tx, orderId, "sync_failed", `Could not send to Zuuvy: ${message}`, "platform");
  });
}

/** What a customer sees on their order page — nothing internal. */
export type PublicOrder = Pick<
  Order,
  "number" | "status" | "lines" | "subtotal" | "discount" | "discounts" | "adjustments" | "total" | "currency" | "payment_method" | "created_at"
> & {
  customerName: string;
  events: { status: string; note: string; created_at: Date }[];
};

export async function publicOrder(tx: Tx, orderId: string): Promise<PublicOrder> {
  const o = await getOrder(tx, orderId);
  return {
    number: o.number,
    status: o.status,
    lines: o.lines,
    subtotal: o.subtotal,
    discount: o.discount,
    discounts: o.discounts,
    adjustments: o.adjustments,
    total: o.total,
    currency: o.currency,
    payment_method: o.payment_method,
    created_at: o.created_at,
    customerName: o.customer.name,
    events: o.events
      .filter((e) => e.source !== "platform")
      .map((e) => ({ status: e.status, note: e.note, created_at: e.created_at })),
  };
}
