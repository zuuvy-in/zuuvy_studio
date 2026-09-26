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
- **Next 16**: `params`/`searchParams`/`cookies()`/`headers()` are async;
  `next dev` writes `AGENTS.md`/`CLAUDE.md` into each app — keep them.
