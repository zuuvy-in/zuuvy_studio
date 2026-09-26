/**
 * A stand-in for Zuuvy's channel API, for development and tests. It speaks
 * exactly `contract.ts` — the same schemas the client parses with — keeps its
 * state in memory, and has a small control page at `/` where you play the
 * business: accept, pack, deliver or reject an order, change a price, run out
 * of stock. Each of those sends a signed webhook like the real thing would.
 *
 * Not a model of Zuuvy's internals: no tiers, no stock lots. Stock is
 * reserved when an order is accepted (or on arrival, for a paid order) and
 * returned when it is cancelled or rejected, which is the one rule the
 * storefront depends on.
 */
import { randomUUID } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  API_PREFIX,
  CreateOrderRequest,
  HEADERS,
  RegisterWebhookRequest,
  type ZuuvyOrderStatus,
  type ZuuvyProduct,
} from "./contract";
import { sign } from "./signature";

type Product = ZuuvyProduct & { price: number | null; stock: number | null };
type Order = {
  id: string;
  request_id: string;
  order_ref: string;
  status: ZuuvyOrderStatus;
  body: CreateOrderRequest;
  reserved: boolean;
  created_at: string;
};
type Delivery = { at: string; event: string; status: number | string };

export type MockZuuvyOptions = {
  port?: number;
  apiKey?: string;
  tenant?: string;
  tenantName?: string;
  tracksStock?: boolean;
};

const img = (seed: string) => `https://picsum.photos/seed/${seed}/640/640`;

function seedProducts(): Product[] {
  const now = new Date().toISOString();
  const rows: [string, string, string, number, number | null, number][] = [
    ["USB-C fast charger 33W", "Chargers", "Charges most phones to 50% in about 25 minutes.", 899, 1299, 42],
    ["Braided USB-C cable 1.5m", "Cables", "Nylon-braided, tested for 20,000 bends.", 349, 499, 120],
    ["Wireless earbuds Pro", "Audio", "Active noise cancelling, 30 hours with the case.", 2499, 3999, 18],
    ["Wired earphones with mic", "Audio", "Tangle-free flat cable, in-line remote.", 299, 399, 75],
    ["Tempered glass (pack of 2)", "Protection", "9H hardness, bubble-free install frame included.", 199, 349, 200],
    ["Shockproof clear case", "Protection", "Raised edges, anti-yellowing.", 349, 599, 64],
    ["10,000 mAh power bank", "Power", "Two outputs, 22.5W fast charging.", 1299, 1999, 9],
    ["Car charger dual port", "Chargers", "USB-C + USB-A, 38W total.", 599, 899, 0],
    ["Bluetooth speaker Mini", "Audio", "Pocket size, IPX5 splash resistant.", 1199, 1799, 23],
    ["Phone stand, aluminium", "Accessories", "Adjustable angle, folds flat.", 449, 699, 31],
  ];
  return rows.map(([name, category, description, price, mrp, stock], i) => ({
    id: String(1001 + i),
    name,
    category,
    description,
    price,
    mrp,
    unit_label: "Pcs",
    images: [img(`zuuvy-${1001 + i}`)],
    stock,
    in_stock: stock > 0,
    listed: true,
    updated_at: now,
  }));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json") {
  res.writeHead(status, { "content-type": type });
  res.end(type === "application/json" ? JSON.stringify(body) : String(body));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function startMockZuuvy(opts: MockZuuvyOptions = {}) {
  const apiKey = opts.apiKey ?? "zk_test_demo";
  const tenant = opts.tenant ?? "demo";
  const tenantName = opts.tenantName ?? "Demo Mobiles";
  const tracksStock = opts.tracksStock ?? true;

  const state = {
    products: seedProducts(),
    orders: [] as Order[],
    webhook: null as null | { url: string; secret: string },
    deliveries: [] as Delivery[],
    orderSeq: 5000,
  };

  function touch(p: Product) {
    p.updated_at = new Date().toISOString();
    p.in_stock = p.stock === null ? true : p.stock > 0;
  }

  async function emit(event: string, data: unknown): Promise<number | string> {
    if (!state.webhook) return "no webhook registered";
    const body = JSON.stringify({ id: randomUUID(), event, occurred_at: new Date().toISOString(), data });
    const deliveryId = JSON.parse(body).id as string;
    let status: number | string;
    try {
      const res = await fetch(state.webhook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HEADERS.signature]: sign(state.webhook.secret, body),
          [HEADERS.event]: event,
          [HEADERS.delivery]: deliveryId,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
    } catch (e) {
      status = (e as Error).message;
    }
    state.deliveries.unshift({ at: new Date().toISOString(), event, status });
    state.deliveries.length = Math.min(state.deliveries.length, 50);
    return status;
  }

  function adjustStock(order: Order, sign: 1 | -1) {
    if (!tracksStock) return;
    for (const line of order.body.lines) {
      const p = state.products.find((x) => x.id === line.product_id);
      if (p && p.stock !== null) {
        p.stock = Math.max(0, p.stock + sign * line.quantity);
        touch(p);
      }
    }
  }

  /** Move an order, reserving at confirmation and releasing on the way out. */
  async function setStatus(orderId: string, status: ZuuvyOrderStatus, note?: string) {
    const order = state.orders.find((o) => o.id === orderId);
    if (!order) throw new Error(`no order ${orderId}`);
    if (status === "accepted" && !order.reserved) {
      adjustStock(order, -1);
      order.reserved = true;
    }
    if ((status === "cancelled" || status === "rejected") && order.reserved) {
      adjustStock(order, 1);
      order.reserved = false;
    }
    order.status = status;
    const code = await emit("order.status_changed", {
      order_id: order.id,
      request_id: order.request_id,
      status,
      ...(note ? { note } : {}),
    });
    for (const line of order.body.lines) {
      const p = state.products.find((x) => x.id === line.product_id);
      if (p && tracksStock) await emit("product.updated", p);
    }
    return code;
  }

  async function updateProduct(id: string, patch: Partial<Pick<Product, "price" | "stock" | "listed" | "name">>) {
    const p = state.products.find((x) => x.id === id);
    if (!p) throw new Error(`no product ${id}`);
    Object.assign(p, patch);
    touch(p);
    return p.listed ? emit("product.updated", p) : emit("product.removed", { id: p.id });
  }

  function authorised(req: IncomingMessage) {
    return req.headers.authorization === `Bearer ${apiKey}` && req.headers["x-tenant"] === tenant;
  }

  async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
    const path = url.pathname.slice(API_PREFIX.length);
    if (!authorised(req)) return send(res, 401, { detail: "Invalid channel key for this organisation." });

    if (req.method === "GET" && path === "/me") {
      return send(res, 200, {
        channel: { id: "ch_1", name: "Online store" },
        tenant: { slug: tenant, name: tenantName, brand: { primary_color: "#1f4fd8", logo_url: null } },
        price_tier: "Retail",
        tracks_stock: tracksStock,
        currency: "INR",
      });
    }
    if (req.method === "PUT" && path === "/webhook") {
      const body = RegisterWebhookRequest.safeParse(JSON.parse((await readBody(req)) || "{}"));
      if (!body.success) return send(res, 400, { detail: body.error.issues[0]?.message });
      state.webhook = body.data;
      return send(res, 200, { url: body.data.url });
    }
    if (req.method === "GET" && path === "/products") {
      const since = url.searchParams.get("updated_since");
      const cursor = Number(url.searchParams.get("cursor") ?? 0);
      const pageSize = 4;
      // A full sync lists what is on sale; an incremental one also reports
      // what was taken down, so the storefront can hide it.
      const pool = state.products
        .filter((p) => (since ? p.updated_at > since : p.listed))
        .map((p) => (tracksStock ? p : { ...p, stock: null, in_stock: true }));
      const results = pool.slice(cursor, cursor + pageSize);
      const next = cursor + pageSize < pool.length ? String(cursor + pageSize) : null;
      return send(res, 200, { results, next_cursor: next });
    }
    if (req.method === "POST" && path === "/orders") {
      const parsed = CreateOrderRequest.safeParse(JSON.parse((await readBody(req)) || "{}"));
      if (!parsed.success) return send(res, 400, { detail: parsed.error.issues[0]?.message });
      const existing = state.orders.find((o) => o.request_id === parsed.data.request_id);
      if (existing) return send(res, 200, { order: { id: existing.id, status: existing.status } });
      for (const line of parsed.data.lines) {
        const p = state.products.find((x) => x.id === line.product_id);
        if (!p || !p.listed) return send(res, 422, { detail: `Product ${line.product_id} is not listed online.` });
      }
      const order: Order = {
        id: String(++state.orderSeq),
        request_id: parsed.data.request_id,
        order_ref: parsed.data.order_ref,
        status: "received",
        body: parsed.data,
        reserved: false,
        created_at: new Date().toISOString(),
      };
      // Paid online: confirmed the moment it arrives, so stock is reserved now.
      if (parsed.data.payment.status === "paid") {
        adjustStock(order, -1);
        order.reserved = true;
        order.status = "accepted";
      }
      state.orders.unshift(order);
      return send(res, 201, { order: { id: order.id, status: order.status } });
    }
    return send(res, 404, { detail: "Not found" });
  }

  function page(): string {
    const next: Record<ZuuvyOrderStatus, ZuuvyOrderStatus[]> = {
      received: ["accepted", "rejected"],
      accepted: ["packed", "cancelled"],
      packed: ["out_for_delivery", "cancelled"],
      out_for_delivery: ["delivered"],
      delivered: [],
      rejected: [],
      cancelled: [],
    };
    const orders = state.orders
      .map(
        (o) => `<tr><td>#${o.id}<br><small>${esc(o.order_ref)}</small></td>
        <td>${esc(o.body.customer.name)}<br><small>${esc(o.body.customer.phone)}</small></td>
        <td>${o.body.lines.map((l) => `${l.quantity} × ${esc(state.products.find((p) => p.id === l.product_id)?.name ?? l.product_id)}`).join("<br>")}</td>
        <td>₹${o.body.totals.total}<br><small>${o.body.payment.method.toUpperCase()} · ${o.body.payment.status}</small></td>
        <td><b>${o.status}</b></td>
        <td>${next[o.status].map((s) => `<form method="post" action="/mock/orders/${o.id}/status"><input type="hidden" name="status" value="${s}"><button>${s.replace(/_/g, " ")}</button></form>`).join("")}</td></tr>`,
      )
      .join("");
    const products = state.products
      .map(
        (p) => `<tr><td>${p.id}</td><td>${esc(p.name)}</td><td>${p.listed ? "listed" : "<i>unlisted</i>"}</td>
        <td><form method="post" action="/mock/products/${p.id}"><input name="price" value="${p.price ?? ""}" size="6"> <input name="stock" value="${p.stock ?? ""}" size="4">
        <select name="listed"><option value="1"${p.listed ? " selected" : ""}>listed</option><option value="0"${p.listed ? "" : " selected"}>unlisted</option></select>
        <button>save</button></form></td></tr>`,
      )
      .join("");
    const deliveries = state.deliveries.map((d) => `<li>${d.at} · ${d.event} → ${d.status}</li>`).join("");
    return `<!doctype html><meta charset="utf-8"><title>Mock Zuuvy</title>
<style>body{font:14px system-ui;margin:24px;color:#0f172a}table{border-collapse:collapse;width:100%;margin-bottom:24px}td,th{border-bottom:1px solid #e2e8f0;padding:6px 8px;text-align:left;vertical-align:top}form{display:inline}button{margin:2px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer}small{color:#64748b}h1{font-size:18px}h2{font-size:15px;margin-top:24px}</style>
<h1>Mock Zuuvy — ${esc(tenantName)} (<code>${esc(tenant)}</code>)</h1>
<p>Channel key <code>${esc(apiKey)}</code> · webhook ${state.webhook ? `<code>${esc(state.webhook.url)}</code>` : "<i>not registered yet — connect Zuuvy in the studio</i>"}</p>
<h2>Orders</h2><table><tr><th>Order</th><th>Customer</th><th>Lines</th><th>Total</th><th>Status</th><th>Act as the business</th></tr>${orders || '<tr><td colspan="6"><i>No orders yet — place one on the storefront.</i></td></tr>'}</table>
<h2>Products</h2><table><tr><th>Id</th><th>Name</th><th></th><th>Price · stock · listing</th></tr>${products}</table>
<h2>Webhook deliveries</h2><ul>${deliveries || "<li><i>none</i></li>"}</ul>`;
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname.startsWith(API_PREFIX)) return await api(req, res, url);
      if (req.method === "GET" && url.pathname === "/") return send(res, 200, page(), "text/html; charset=utf-8");
      const form = req.method === "POST" ? new URLSearchParams(await readBody(req)) : null;
      let m = url.pathname.match(/^\/mock\/orders\/(\w+)\/status$/);
      if (form && m) {
        await setStatus(m[1]!, form.get("status") as ZuuvyOrderStatus);
        res.writeHead(303, { location: "/" });
        return res.end();
      }
      m = url.pathname.match(/^\/mock\/products\/(\w+)$/);
      if (form && m) {
        const num = (k: string) => (form.get(k) === "" || form.get(k) === null ? null : Number(form.get(k)));
        await updateProduct(m[1]!, { price: num("price"), stock: num("stock"), listed: form.get("listed") !== "0" });
        res.writeHead(303, { location: "/" });
        return res.end();
      }
      send(res, 404, { detail: "Not found" });
    } catch (e) {
      send(res, 500, { detail: (e as Error).message });
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    apiKey,
    tenant,
    state,
    setStatus,
    updateProduct,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type MockZuuvy = Awaited<ReturnType<typeof startMockZuuvy>>;
