# Cart and checkout plugins

A plugin is an outside service a business connects to its stores' cart and
checkout (Studio → Plugins). The platform calls it at the moments it chooses,
over https, signed with a secret shown once when the plugin is connected.

## The call

`POST <your url>` with a JSON body whose `hook` names the moment, and headers:

- `X-Zuuvy-Hook: cart.calculate`
- `X-Zuuvy-Signature: t=<unix seconds>,v1=<hex>` — `v1` is HMAC-SHA256 of
  `"<t>.<raw body>"` with your secret. Check it, and reject old `t` values.

Answer within **3 seconds** with at most **64 KB** of JSON and a 2xx status.
No redirects are followed. The address must be public https.

## Hooks

| Hook | Body carries | Answer |
|---|---|---|
| `cart.calculate` | `site`, `cart` (`lines`, `subtotal`, `discount`), `customer` | `{ "adjustments": [{ "label", "amount" }], "messages": [{ "text", "tone" }] }` — amount in rupees, negative for money off; at most 5 of each; tone `info`/`success`/`warning` |
| `checkout.fields` | as above | `{ "fields": [{ "name", "label", "type", "required", "options", "help" }] }` — `name` is `^[a-z][a-z0-9_]{0,30}$`, type `text`/`textarea`/`select`/`checkbox`/`date`; at most 6 |
| `checkout.validate` | `site`, `cart`, `customer` (name, phone, address), `extra` (answers to fields) | `{ "ok": true }` or `{ "ok": false, "error": "…" }` — the error is shown to the customer and the order is not placed |
| `order.placed` | `order` (number, status, customer, lines, subtotal, discount, total, discounts, adjustments, extra) | anything 2xx; retried from the outbox until then |

## What the platform guarantees the business

- A plugin that is slow, down, or answers something that does not match the
  contract is **skipped** — the sale goes on without it — and the problem is
  shown on the Plugins page.
- Adjustments are bounded by the cart's subtotal and the total never goes
  below zero.
- Answers to plugin questions are stored on the order (`orders.extra`) and
  shown with it in the studio.
