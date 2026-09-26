/**
 * The Zuuvy connector: products marked for online listing come in, orders go
 * out, order updates come back.
 *
 * Stock is reserved on Zuuvy's side at *confirmation* — for a prepaid order
 * when the payment is captured (it arrives already `paid`), for cash on
 * delivery when the business accepts it in Zuuvy, which then sends
 * `accepted`. This side never reserves anything; it reflects what Zuuvy says.
 */
import type { z } from "zod";
import {
  type Connection,
  ConnectorError,
  type Connector,
  type CatalogItem,
  type InboundEvent,
  type OrderStatus,
} from "../types";
import {
  API_PREFIX,
  CreateOrderResponse,
  HEADERS,
  MeResponse,
  OrderStatusChanged,
  ProductRemoved,
  ProductsResponse,
  RegisterWebhookResponse,
  WebhookEnvelope,
  ZuuvyProduct,
  type CreateOrderRequest,
  type ZuuvyOrderStatus,
} from "./contract";
import { verify } from "./signature";

export type ZuuvyConfig = { baseUrl: string; tenant: string };
export type ZuuvySecrets = { apiKey: string };

export const DEFAULT_ZUUVY_API = "https://api.zuuvy.in";

export const STATUS_MAP: Record<ZuuvyOrderStatus, OrderStatus> = {
  received: "pending",
  accepted: "confirmed",
  rejected: "rejected",
  packed: "packed",
  out_for_delivery: "shipped",
  delivered: "delivered",
  cancelled: "cancelled",
};

const TIMEOUT_MS = 15_000;

/**
 * The API URL is fixed to Zuuvy's own unless overrides are switched on for
 * development: a user-supplied URL that the server then fetches is a request
 * forgery door into the platform's own network (the instance metadata
 * endpoint, the database). Overrides are for pointing at the local mock.
 */
function resolveBaseUrl(input: string | undefined): string {
  const fallback = process.env.ZUUVY_API_URL || DEFAULT_ZUUVY_API;
  const wanted = (input || "").trim().replace(/\/+$/, "") || fallback;
  if (wanted === fallback.replace(/\/+$/, "")) return wanted;
  if (process.env.ZSITE_ALLOW_CUSTOM_ZUUVY_URL === "1") {
    try {
      new URL(wanted);
    } catch {
      throw new ConnectorError("That API URL is not a valid URL.", false);
    }
    return wanted;
  }
  throw new ConnectorError(`Zuuvy is reached at ${fallback}; a different API URL is not allowed here.`, false);
}

async function call<T>(
  conn: Connection<ZuuvyConfig, ZuuvySecrets>,
  method: string,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const url = `${conn.config.baseUrl}${API_PREFIX}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${conn.secrets.apiKey}`,
        "x-tenant": conn.config.tenant,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch (e) {
    throw new ConnectorError(`Could not reach Zuuvy: ${(e as Error).message}`, true);
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text) as { detail?: string; error?: string };
      detail = j.detail ?? j.error ?? detail;
    } catch {
      /* not JSON */
    }
    if (res.status === 401 || res.status === 403) {
      throw new ConnectorError(`Zuuvy refused the key (${res.status}): ${detail}`, false, res.status);
    }
    throw new ConnectorError(`Zuuvy answered ${res.status}: ${detail}`, res.status >= 500 || res.status === 429, res.status);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ConnectorError("Zuuvy answered with something that is not JSON.", true);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ConnectorError(`Zuuvy's answer did not match the contract: ${parsed.error.issues[0]?.message}`, false);
  }
  return parsed.data;
}

export function toCatalogItem(p: z.output<typeof ZuuvyProduct>): CatalogItem {
  return {
    externalId: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    price: p.price,
    mrp: p.mrp,
    unitLabel: p.unit_label,
    images: p.images.filter((u) => /^https:\/\//i.test(u)),
    stock: p.stock,
    inStock: p.in_stock,
    listed: p.listed,
  };
}

export const zuuvy: Connector<ZuuvyConfig, ZuuvySecrets> = {
  kind: "zuuvy",
  name: "Zuuvy",
  tagline: "Your catalogue, stock and orders from Zuuvy",
  description:
    "Lists the products you mark for online sale in Zuuvy, sends every order placed here into Zuuvy, and updates the order as your team accepts, packs and delivers it. Stock is reserved in Zuuvy when an order is confirmed.",
  category: "commerce",
  availability: "available",
  capabilities: ["catalog", "orders", "order_updates"],
  fields: [
    {
      name: "tenant",
      label: "Zuuvy organisation",
      kind: "text",
      placeholder: "pcomm",
      help: "Your organisation's short name in Zuuvy — shown under Settings → Online store.",
      required: true,
    },
    {
      name: "apiKey",
      label: "Channel key",
      kind: "secret",
      placeholder: "zk_live_…",
      help: "Create one in Zuuvy under Settings → Online store → Connect a storefront.",
      required: true,
    },
    {
      name: "baseUrl",
      label: "API URL",
      kind: "url",
      placeholder: DEFAULT_ZUUVY_API,
      help: "Leave blank. Only changed for development against a local Zuuvy.",
    },
  ],

  parse(input) {
    const tenant = (input.tenant ?? "").trim().toLowerCase();
    const apiKey = (input.apiKey ?? "").trim();
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(tenant)) throw new ConnectorError("Enter your Zuuvy organisation's short name.", false);
    if (apiKey.length < 8) throw new ConnectorError("Enter the channel key from Zuuvy.", false);
    return { config: { tenant, baseUrl: resolveBaseUrl(input.baseUrl) }, secrets: { apiKey } };
  },

  async test(conn) {
    const me = await call(conn, "GET", "/me", MeResponse);
    if (me.tenant.slug !== conn.config.tenant) {
      throw new ConnectorError(`That key belongs to ${me.tenant.name} (${me.tenant.slug}), not ${conn.config.tenant}.`, false);
    }
    return {
      headline: me.tenant.name,
      details: {
        Organisation: `${me.tenant.name} (${me.tenant.slug})`,
        Channel: me.channel.name,
        "Price tier": me.price_tier,
        "Tracks stock": me.tracks_stock ? "Yes" : "No",
        Currency: me.currency,
      },
    };
  },

  async registerWebhook(conn, url, secret) {
    await call(conn, "PUT", "/webhook", RegisterWebhookResponse, { url, secret });
  },

  async fetchCatalog(conn, { since, cursor }) {
    const q = new URLSearchParams();
    if (since) q.set("updated_since", since.toISOString());
    if (cursor) q.set("cursor", cursor);
    const qs = q.toString();
    const page = await call(conn, "GET", `/products${qs ? `?${qs}` : ""}`, ProductsResponse);
    return { items: page.results.map(toCatalogItem), nextCursor: page.next_cursor };
  },

  async pushOrder(conn, order) {
    const body: CreateOrderRequest = {
      request_id: order.requestId,
      order_ref: order.reference,
      customer: order.customer,
      lines: order.lines.map((l) => ({ product_id: l.externalProductId, quantity: l.quantity, unit_price: l.unitPrice })),
      payment: order.payment,
      totals: { subtotal: order.subtotal, total: order.total },
      ...(order.note ? { note: order.note } : {}),
    };
    const res = await call(conn, "POST", "/orders", CreateOrderResponse, body);
    return { externalOrderId: res.order.id, externalStatus: res.order.status, status: STATUS_MAP[res.order.status] };
  },

  parseWebhook(webhookSecret, headers, rawBody, now) {
    const check = verify(webhookSecret, headers[HEADERS.signature], rawBody, now);
    if (!check.ok) throw new ConnectorError(`Webhook refused: ${check.reason}`, false, 401);
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new ConnectorError("Webhook body is not JSON", false, 400);
    }
    const env = WebhookEnvelope.safeParse(json);
    if (!env.success) throw new ConnectorError("Webhook envelope did not match the contract", false, 400);
    const { id: deliveryId, event, data } = env.data;

    const parsed = ((): InboundEvent | null => {
      switch (event) {
        case "order.status_changed": {
          const d = OrderStatusChanged.safeParse(data);
          if (!d.success) return null;
          return {
            kind: "order.status",
            deliveryId,
            requestId: d.data.request_id,
            externalOrderId: d.data.order_id,
            status: STATUS_MAP[d.data.status],
            externalStatus: d.data.status,
            ...(d.data.note ? { note: d.data.note } : {}),
          };
        }
        case "product.updated": {
          const d = ZuuvyProduct.safeParse(data);
          return d.success ? { kind: "product.upsert", deliveryId, item: toCatalogItem(d.data) } : null;
        }
        case "product.removed": {
          const d = ProductRemoved.safeParse(data);
          return d.success ? { kind: "product.remove", deliveryId, externalId: d.data.id } : null;
        }
        default:
          // A newer Zuuvy may send events this build does not know. Accept and
          // log them rather than failing — a 4xx would make Zuuvy retry forever.
          return { kind: "ignored", deliveryId, topic: event };
      }
    })();
    if (!parsed) throw new ConnectorError(`Webhook ${event} data did not match the contract`, false, 400);
    return parsed;
  },
};
