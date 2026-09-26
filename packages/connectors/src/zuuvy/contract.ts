/**
 * The Zuuvy channel API, v1 — the wire contract between Zuuvy (the business
 * system: stock, orders, money) and this platform (the storefront). The two
 * are deployed and versioned independently; this file is the one place the
 * shape is written down on this side, and `docs/ZUUVY_CONTRACT.md` is the
 * human-readable copy the Zuuvy backend implements against.
 *
 * Shared by the client and the development mock, so the mock cannot drift
 * from what the client expects.
 */
import { z } from "zod";

export const API_PREFIX = "/api/channels/v1";

export const ZuuvyProduct = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string(),
  description: z.string().nullish().transform((v) => v ?? ""),
  category: z.string().nullish().transform((v) => v ?? null),
  /** Price at the channel's price tier, in rupees; null when that tier has no price. */
  price: z.number().nullable(),
  mrp: z.number().nullish().transform((v) => v ?? null),
  unit_label: z.string().nullish().transform((v) => v ?? null),
  images: z.array(z.string()).default([]),
  /** null for a business that does not track stock (`tracks_stock: false`). */
  stock: z.number().nullable(),
  in_stock: z.boolean(),
  /** Marked to be listed online. false in an incremental sync = take it down. */
  listed: z.boolean(),
  updated_at: z.string(),
});
export type ZuuvyProduct = z.input<typeof ZuuvyProduct>;

export const MeResponse = z.object({
  channel: z.object({ id: z.union([z.string(), z.number()]).transform(String), name: z.string() }),
  tenant: z.object({
    slug: z.string(),
    name: z.string(),
    brand: z
      .object({ primary_color: z.string().nullish(), logo_url: z.string().nullish() })
      .partial()
      .default({}),
  }),
  price_tier: z.string(),
  tracks_stock: z.boolean(),
  currency: z.string().default("INR"),
});

export const ProductsResponse = z.object({
  results: z.array(ZuuvyProduct),
  next_cursor: z.string().nullable(),
});

export const OrderStatus = z.enum([
  "received",
  "accepted",
  "rejected",
  "packed",
  "out_for_delivery",
  "delivered",
  "cancelled",
]);
export type ZuuvyOrderStatus = z.infer<typeof OrderStatus>;

export const CreateOrderRequest = z.object({
  request_id: z.string().min(1).max(64),
  order_ref: z.string().max(40),
  customer: z.object({ name: z.string(), phone: z.string(), address: z.string() }),
  lines: z
    .array(
      z.object({
        product_id: z.string(),
        quantity: z.number().positive(),
        unit_price: z.number().nonnegative(),
      }),
    )
    .min(1),
  payment: z.object({
    method: z.enum(["cod", "online"]),
    status: z.enum(["unpaid", "paid"]),
    gateway: z.string().optional(),
    reference: z.string().optional(),
  }),
  totals: z.object({ subtotal: z.number(), total: z.number() }),
  note: z.string().optional(),
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequest>;

export const CreateOrderResponse = z.object({
  order: z.object({ id: z.union([z.string(), z.number()]).transform(String), status: OrderStatus }),
});

export const RegisterWebhookRequest = z.object({ url: z.url(), secret: z.string().min(24) });
export const RegisterWebhookResponse = z.object({ url: z.string() });

export const WebhookEnvelope = z.object({
  id: z.string(),
  event: z.string(),
  occurred_at: z.string(),
  data: z.unknown(),
});

export const OrderStatusChanged = z.object({
  order_id: z.union([z.string(), z.number()]).transform(String),
  request_id: z.string(),
  status: OrderStatus,
  note: z.string().nullish(),
});

export const ProductRemoved = z.object({ id: z.union([z.string(), z.number()]).transform(String) });

export const HEADERS = {
  signature: "x-zuuvy-signature",
  event: "x-zuuvy-event",
  delivery: "x-zuuvy-delivery",
} as const;
