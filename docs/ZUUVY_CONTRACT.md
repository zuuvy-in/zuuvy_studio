# Zuuvy channel API — v1

The contract between **Zuuvy** (the business system: catalogue, stock, orders,
money) and **Zuuvy Sites** (the storefront). The two are deployed and versioned
independently; this document is what the Zuuvy backend implements, and
`packages/connectors/src/zuuvy/contract.ts` is the same contract as code. The
mock in `packages/connectors/src/zuuvy/mock-server.ts` implements it for
development, and the platform tests run against that mock.

## Principles

- **One owner per fact.** Zuuvy owns products, prices, stock and an order's
  progress. The storefront owns the customer's checkout and its own order
  number. Nothing is edited on both sides.
- **The storefront never reserves stock.** Zuuvy reserves at **confirmation**:
  - an order that arrives **paid online** is confirmed on arrival, so stock is
    reserved then;
  - a **cash-on-delivery** order is confirmed when the business **accepts** it
    in Zuuvy, which reserves stock and sends `accepted`.
  Rejecting or cancelling a confirmed order returns the stock.
- **Everything is retry-safe.** Order creation is idempotent on `request_id`;
  webhooks are de-duplicated on their delivery id and may arrive out of order.

## Authentication

Every request carries:

```
Authorization: Bearer <channel key>
X-Tenant: <organisation slug>
```

A channel key belongs to **the business, not a person**: deactivating the admin
who created it must not break the store. `401` means the key is wrong or
revoked; `403` means it does not belong to the organisation named by
`X-Tenant`. (Later: "Sign in with Zuuvy" OAuth issues the same channel
credential from a consent screen, so nobody copies a key by hand.)

Base URL: `https://api.zuuvy.in`, prefix `/api/channels/v1`.

## Endpoints

### `GET /me`

What the key reaches. The storefront calls this to test a connection.

```json
{
  "channel": { "id": "ch_1", "name": "Online store" },
  "tenant": { "slug": "pcomm", "name": "Pooja Communications", "brand": { "primary_color": "#1f4fd8", "logo_url": "https://…" } },
  "price_tier": "Retail",
  "tracks_stock": true,
  "currency": "INR"
}
```

### `PUT /webhook`

Where to send events, and the secret to sign them with. Called automatically
when the store connects and when the owner rotates the secret; the new secret
replaces the old one immediately.

```json
{ "url": "https://api.zuuvy.site/api/hooks/7f1c…", "secret": "<32+ chars>" }
```

→ `200 { "url": "…" }`

### `GET /products?updated_since=<ISO 8601>&cursor=<opaque>`

- Without `updated_since`: a **full** listing of every product marked for
  online sale on this channel.
- With it: every product **changed** since then — including ones taken off
  online sale, which come back with `"listed": false` so the storefront can
  hide them.
- Paged: follow `next_cursor` until it is `null`.

```json
{
  "results": [
    {
      "id": "1001",
      "name": "USB-C fast charger 33W",
      "description": "…",
      "category": "Chargers",
      "price": 899,
      "mrp": 1299,
      "unit_label": "Pcs",
      "images": ["https://…"],
      "stock": 42,
      "in_stock": true,
      "listed": true,
      "updated_at": "2026-09-26T10:00:00Z"
    }
  ],
  "next_cursor": null
}
```

`price` is the channel's price tier, in rupees; `null` means that tier has no
price and the storefront will not sell it. `stock` is `null` for a business with
`tracks_stock: false`.

### `POST /orders`

```json
{
  "request_id": "0b6c…",           // the storefront's order id: the idempotency key
  "order_ref": "WEB-1042",         // what the customer sees
  "customer": { "name": "Ravi Kumar", "phone": "9876543210", "address": "12 Boring Road, Patna" },
  "lines": [{ "product_id": "1001", "quantity": 2, "unit_price": 899 }],
  "payment": { "method": "cod", "status": "unpaid" },
  "totals": { "subtotal": 1798, "total": 1798 },
  "note": "Call before coming"
}
```

→ `201 { "order": { "id": "5001", "status": "received" } }`

- A repeat of the same `request_id` returns `200` with the **same** order.
- `payment.status: "paid"` (with `gateway` and `reference`) means the customer
  has paid online: Zuuvy confirms and reserves immediately and answers
  `"status": "accepted"`.
- `422` if a line names a product not listed online; the storefront treats any
  4xx other than 429 as permanent and shows it on the order.

## Webhooks

`POST <registered url>` with:

```
X-Zuuvy-Event: order.status_changed
X-Zuuvy-Delivery: <uuid, unique per delivery attempt group>
X-Zuuvy-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
```

```json
{ "id": "<same uuid>", "event": "order.status_changed", "occurred_at": "…", "data": { … } }
```

The storefront refuses a signature older than five minutes, answers `200` for a
duplicate delivery, and `200` for events it does not use (so a newer Zuuvy can
add events without breaking older storefronts). Retry on anything but 2xx.

| Event | `data` |
|---|---|
| `order.status_changed` | `{ "order_id": "5001", "request_id": "0b6c…", "status": "accepted", "note": "optional" }` |
| `product.updated` | a product, exactly as in `GET /products` (also sent when stock changes) |
| `product.removed` | `{ "id": "1001" }` — taken off online sale |

Order statuses, and what the storefront shows:

| Zuuvy | Storefront |
|---|---|
| `received` | Waiting for confirmation |
| `accepted` | Confirmed (stock reserved) |
| `rejected` | Declined |
| `packed` | Packed |
| `out_for_delivery` | Out for delivery |
| `delivered` | Delivered |
| `cancelled` | Cancelled |

The storefront only moves an order **forward**; a late `accepted` after
`packed` is logged and ignored.

## What the Zuuvy backend needs (for `zuuvy_backend`)

Written against that repository's conventions (see its `CLAUDE.md`):

1. **Online listing.** A per-channel listing flag on products (a
   `ChannelListing(channel, product)` row rather than a boolean, so a business
   can run two storefronts), plus the channel's price tier.
2. **Channel credentials.** A `SalesChannel` model in `tenants` (the
   `PaymentConfig` reason: the Tenant Admin group gets nothing over `tenants`)
   holding a hashed key, the price tier and the webhook URL and secret. The
   authentication class resolves the tenant from the key and checks it against
   `X-Tenant`, as `TenantMembership` does for user tokens.
3. **Order intake.** `POST /orders` creates an `Orders` row with a
   `source = "storefront"` marker, the buyer resolved by phone through
   `customers.resolve` as a counter sale's is, idempotent through
   `claim_idempotency_key(request, "channel_order")` keyed on `request_id`.
   A paid order writes a confirmed `Transactions` row in its payment mode.
4. **Reserve at confirmation.** For storefront orders, make the existing
   `claim_order_stock` / `Orders.stock_moved` claim when the order is
   *accepted* (or on arrival when paid), not at release. Release then finds
   `stock_moved` already set and moves nothing; cancel and reject go through
   `return_order_stock` as today. No new counter, no reserved column.
5. **Outbound webhooks.** Fired from `transaction.on_commit`, next to the
   `audit.record()` calls that already mark each order transition (including
   the conditional `.update()` ones a `post_save` signal would miss), and on
   product/stock changes for listed products. Signed as above, retried with
   backoff from Celery (`TenantTask`), delivery ids kept for de-duplication.
