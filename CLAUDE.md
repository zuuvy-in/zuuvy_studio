# CLAUDE.md — Zuuvy Sites (`zuuvy_site`)

AI-first website platform (landing / portfolio / store) for Zuuvy's customers
first. npm workspaces, TypeScript, Next.js 16, PostgreSQL with RLS. Read
`docs/ARCHITECTURE.md` before changing anything structural and
`docs/ZUUVY_CONTRACT.md` before touching the Zuuvy connector.

## Commands

```bash
npm run db:start && npm run db:migrate && npm run db:seed
npm run dev          # studio :3000, renderer :3001 (<sub>.localhost), worker, mock Zuuvy :4010
npm test             # vitest; platform tests create a throwaway DB per file on :54329
npm run typecheck
npm run admin:create   # platform superadmin (rishav@zuuvy.in by default)
npm run db:seed:shop   # local: variants, discounts and a cart drawer on the demo store
```

## Things that will bite you

- **A site is a tree, edited only through `applyOps`** (`packages/core`). The
  AI, templates and the dashboard all go through it. Adding a block = its zod
  schema in `tree.ts` (the AI reads the `.describe()` texts), a label in
  `diff.ts`, a component in `runtime/src/blocks.tsx`.
- **Every tenant query runs in `withTenant()`**; RLS returns nothing
  otherwise. Cross-tenant lookups are `SECURITY DEFINER` functions in the
  migration that return ids only — add one there rather than widening a role.
- **`site_versions`, `integration_events` and `order_events` are
  append-only** for the app role (no UPDATE/DELETE grant). Publishing moves a
  pointer on `sites`.
- **`jsonb` reorders object keys.** Compare trees with `sameValue`/`diffTrees`,
  never `JSON.stringify(a) === JSON.stringify(b)`.
- **Network calls happen outside transactions** (see `integrations.ts`,
  `orders.pushOrder`). Work that must survive a crash is an outbox job written
  in the same transaction as its cause.
- **Every server action calls `requireSession()` itself.** A layout's check
  does not protect an action.
- **The Zuuvy API URL is fixed** unless `ZSITE_ALLOW_CUSTOM_ZUUVY_URL=1`
  (dev only) — a user-supplied URL the server fetches is an SSRF door.
- **Stock is never reserved here.** Zuuvy reserves at confirmation; this side
  mirrors what Zuuvy says and only moves an order forward.
- **AI tools are provider-neutral** (`packages/ai/src/tools.ts`). Bedrock
  (Amazon Nova, the default — AWS-credit-covered) and Anthropic are adapters in
  `providers/`; a new provider maps `SiteTool`s to its format and must return
  thrown tool errors to the model rather than fail the turn.
- **Next 16**: `params`/`searchParams`/`cookies()`/`headers()` are async;
  `next dev` writes `AGENTS.md`/`CLAUDE.md` into each app — keep them.
- **Data is part of a version** (`site_versions.data`, `core/src/data.ts`),
  never a live table. `createVersion` carries the parent's data forward when
  none is given; anything that changes data passes the new data explicitly.
- **The AI never overwrites the owner's data or brand silently.** Data
  overwrites become `ai_meta.proposals`; brand-fixed theme fields are dropped
  in `set_theme` and re-applied by `applyBrand` after every AI edit.
- **A URL the server fetches is an SSRF door** — `references.ts` is the only
  place that does it for user input: public addresses only, DNS pinned into
  the socket, redirects re-checked. Do not add a second fetcher.
- **Deleting a site requires a fresh export** (`archive.deletionCheck`).
- **Platform admins are rows the app cannot write**; changes go through
  `grant_platform_admin`/`revoke_platform_admin`, which check the caller is a
  superadmin in the database.
- **Email is an outbox job** (`email.send`), queued in the transaction that
  caused it; `EMAIL_ENABLED=1` or it is only logged.
- **MCP servers are editor tools** (`packages/ai/src/mcp/`): the design kit
  in-process, remote ones from `ZSITE_MCP_SERVERS` (deployment config, not user
  input). A server that fails is skipped, never fatal. Tests that pass a
  `runner` get no MCP unless they set `mcp`.
- **A model that cannot be used falls back** (`ZSITE_AI_FALLBACK_MODEL`), only
  when nothing was edited yet; errors mark this with `AgentError.unavailable`.
- **Plan first** (`ai/src/plan.ts`, `planVersion`): a plan edits nothing and
  makes no version; the approved plan comes back from the browser and is
  re-validated (`parsePlan`) before `generateVersion` builds it.
- **Selling out of stock** (`sites.out_of_stock = 'sell'`): accepting takes
  what stock exists and records it in `orders.stock_taken`; cancelling returns
  exactly that. Never return the ordered quantity for such an order.
- **Prices are never trusted from the browser.** The cart cookie holds ids and
  quantities only; `quoteCart` and `placeOrder` work out money every time, and
  the order's transaction re-decides discounts.
- **Plugins are the second outbound caller** and go through
  `references.postJson` (same guard). A failing plugin is skipped, never
  fatal. Tests replace the transport with `setPluginTransport`.
- **Variant labels follow the group's option order** (`variantLabel`), never
  `Object.values(product.options)` — jsonb reorders keys.
- **Customer accounts are per business** and orders attach only when placed
  signed in — never by phone number.
