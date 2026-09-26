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
import { ConnectorError, type OrderStatus, type OutboundOrder } from "@zsite/connectors";
import { getProducts } from "./catalog";
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
  subtotal, total, currency, note, external_ref, external_status, sync_state, sync_error, created_at, updated_at`;

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
    const products = new Map((await getProducts(tx, wanted.map((l) => l.productId))).map((p) => [p.id, p]));
    const lines: OrderLine[] = [];
    let subtotal = 0;
    for (const l of wanted) {
      const p = products.get(l.productId);
      if (!p || !p.active || p.price === null) throw new UserError("One of the products is no longer available.");
      if (!p.in_stock) throw new UserError(`${p.name} is out of stock.`);
      if (p.stock !== null && l.quantity > p.stock) {
        throw new UserError(`Only ${p.stock} of ${p.name} ${p.stock === 1 ? "is" : "are"} left.`);
      }
      const line = paise(p.price) * l.quantity;
      subtotal += line;
      lines.push({
        productId: p.id,
        source: p.source,
        externalId: p.external_id,
        name: p.name,
        image: p.images[0] ?? null,
        unitPrice: p.price,
        quantity: l.quantity,
        lineTotal: rupees(line),
      });
    }
    // One order is fulfilled by one system. Mixing a Zuuvy product with a
    // native one would leave half the order with nobody to deliver it.
    const sources = new Set(lines.map((l) => l.source));
    if (sources.size > 1) throw new UserError("Some of these products are delivered separately; please order them separately.");

    const zuuvy = sources.has("zuuvy") ? await getIntegration(tx, "zuuvy") : null;
    const linked = zuuvy !== null && zuuvy.status !== "disconnected";

    const seq = await tx.get<{ n: number }>(
      "update tenants set order_seq = order_seq + 1 where id = app_tenant() returning order_seq as n",
    );
    const publicToken = randomToken(18);
    const order = await tx.get<{ id: string }>(
      `insert into orders (tenant_id, site_id, number, public_token, payment_method, customer, lines,
                           subtotal, total, note, sync_state)
       values (app_tenant(), $1, $2, $3, 'cod', $4, $5, $6, $6, $7, $8) returning id`,
      [input.siteId, seq.n, publicToken, JSON.stringify({ name, phone, address }), JSON.stringify(lines),
        rupees(subtotal), input.note?.trim().slice(0, 500) || null, linked ? "pending" : "not_linked"],
    );
    await addOrderEvent(tx, order.id, "pending", "Order placed — cash on delivery", "storefront");
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
      return { externalProductId: l.externalId, name: l.name, quantity: l.quantity, unitPrice: l.unitPrice };
    }),
    payment: { method: order.payment_method, status: order.payment_status === "paid" ? "paid" : "unpaid" },
    subtotal: order.subtotal,
    total: order.total,
    ...(order.note ? { note: order.note } : {}),
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
export type PublicOrder = Pick<Order, "number" | "status" | "lines" | "total" | "currency" | "payment_method" | "created_at"> & {
  customerName: string;
  events: { status: string; note: string; created_at: Date }[];
};

export async function publicOrder(tx: Tx, orderId: string): Promise<PublicOrder> {
  const o = await getOrder(tx, orderId);
  return {
    number: o.number,
    status: o.status,
    lines: o.lines,
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
