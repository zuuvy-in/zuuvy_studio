# Zuuvy Sites — architecture

An AI-first website platform: landing pages, portfolios and stores, built by
describing them, with templates, plugins and data integrations. Zuuvy's own
customers first; open to anyone after.

## Decisions so far

| Question | Decision |
|---|---|
| First customers | Zuuvy's customers — the Zuuvy connector is the spine |
| Free-form code | Eject to Git; a pushed codebase is imported back as a version |
| Money | Through the tenant's own gateway; through ours only if they pick the default one (split settlement via a licensed aggregator — never funds in our own account), for a flat fee |
| Stock | Reserved in Zuuvy at order confirmation: online-paid on arrival, COD when the business accepts |
| Cloud | AWS end to end; platform domain `zuuvy.site`; domains registered through Route 53 |

## The one idea everything rests on: a site is data

A site is a **tree** (`packages/core/src/tree.ts`): pages hold sections, each
section is one block from the runtime's component library with typed props.
The AI edits it through **operations** (`ops.ts`) — never by writing code —
so:

- edits are non-destructive and validated (an invalid AI call is an error the
  model corrects, never a broken site);
- every version is a snapshot, so versions, diffs (`diff.ts`), compare and
  rollback come for free;
- a template is a saved tree; a marketplace template is the same with slots;
- a runtime upgrade can migrate every site mechanically, and show the owner
  the diff before they accept it.

Free-form code is the escape hatch: **eject** turns a tree into a real Next.js
project depending on `@zsite/runtime` and pushes it to the owner's GitHub; a
push is built in an isolated CodeBuild sandbox and imported as a `code`
version (`site_versions.mode = 'code'`, `git_ref`). The schema carries both
modes today; the eject/import pipeline is the next milestone.

## Repository

```
packages/core        the tree: schema, operations, diff, templates, hosts. Pure.
packages/runtime     runtime 1: React server components that render a tree + CSS
packages/ai          the site agent: Claude editing the tree through tools
packages/connectors  integrations as data + translators (Zuuvy, and the catalogue)
packages/platform    the server: tenant-scoped DB, sites/versions, integrations,
                     catalogue, orders, outbox, webhooks, storefront lookups
apps/studio          the owner's dashboard (studio.zuuvy.site) + webhook receiver
apps/renderer        serves every live site by Host (<name>.zuuvy.site, custom domains)
db/migrations        SQL, applied in order by scripts/migrate.ts
scripts/             dev database, migrate, seed, worker, mock Zuuvy
```

## Multi-tenancy

One Postgres, shared tables, `tenant_id` on every tenant row, and **Row-Level
Security** as the backstop (`db/migrations/0001_init.sql`):

- the app connects as `zsite_app` — owns nothing, cannot bypass RLS;
- `withTenant(id, fn)` sets `app.tenant_id` for one transaction; every query
  inside sees only that tenant, and a query that forgets its filter returns
  *nothing* rather than another business's rows;
- the few lookups that must cross tenants (Host → site, webhook URL →
  integration, claiming queued jobs, a customer's order link) are `SECURITY
  DEFINER` functions that return ids only;
- identity is global (one person, one login, many businesses) — the Zuuvy
  model.

`packages/platform/src/platform.test.ts` proves isolation against a real
database connected as the app role.

### "Upgrade on their own schedule"

The **schema** is one and always current (expand → migrate → contract
migrations, so old and new code both run mid-deploy). What a tenant upgrades
when they choose is the **runtime** their site renders with:
`sites.runtime_version`, with runtimes deployed side by side and routed per
site. Upgrading = the AI migrates the tree to the new runtime → a new version
→ preview, publish, roll back. Templates and plugins are pinned the same way.

## Versions

Immutable rows in `site_versions` (the app role has no UPDATE or DELETE on
them). Publishing moves `sites.published_version_id` and appends to
`site_publications`; rolling back is publishing an older version; restoring
copies an old tree forward as the newest version. The studio shows the whole
history, a live preview of any version (rendered by the same runtime as the
live site), field-level diffs, side-by-side compare, and who/what made each
change — including the prompt and model for AI versions.

## AI

`packages/ai`: Claude through the Anthropic SDK's tool runner, one tool per
operation plus `view_site`. The system prompt carries every block's JSON
schema (generated from the same zod schemas that validate the tree) and is
cached. Output is always a **new unpublished version** parented on the one the
owner was looking at. Model via `ZSITE_AI_MODEL` (default `claude-opus-5`),
with server-side refusal fallback enabled. On AWS this moves to Bedrock or
Claude Platform on AWS; the agent code is unchanged apart from the client.

## Integrations

Connectors (`packages/connectors`) describe a system and translate to and from
it; they never touch the database. The platform seals their credentials
(AES-256-GCM, KMS data key in production), registers webhooks automatically,
and logs every exchange append-only in `integration_events`.

Work that must survive a crash goes through the **outbox** (`outbox` table,
`claim_outbox()` with `SKIP LOCKED`), written in the same transaction as the
change that needs it and drained by the worker with backoff — SQS-fed in
production, the table stays the source of truth.

Zuuvy: see `docs/ZUUVY_CONTRACT.md`.

## AWS deployment (target)

```
Route 53 (zuuvy.site, tenant zones, Domains API for registration)
   │
CloudFront SaaS Manager (multi-tenant distribution, managed certs per custom domain) + WAF
   │  host → site/runtime lookup
   ├── renderer   Next.js on Lambda (OpenNext), one function per runtime version
   ├── studio     Next.js on Lambda/Fargate at studio.zuuvy.site
   └── api        webhook receiver (/api/hooks/*)
Fargate worker (SQS) · Aurora PostgreSQL Serverless v2 (RLS) · S3 media · SES
KMS (credential sealing) · Bedrock (Claude) · CodeBuild (eject/import sandboxes)
Step Functions (domain onboarding: check → register/connect → zone → cert → verify)
```

- **`zuuvy.site` goes on the Public Suffix List**, so one tenant's pages cannot
  set cookies another tenant's pages read. The studio never lives under a
  tenant name (reserved subdomains in `core/src/subdomain.ts`).
- **Custom domains**: buy through Route 53 (zero DNS steps), or connect one
  owned elsewhere via Domain Connect, nameserver delegation, or copied records.
  `site_domains` and host resolution already exist; the onboarding flow is next.

## Not built yet

Custom-domain onboarding · payment gateways (Razorpay/Cashfree; default
gateway via split settlement, flat fee) · WhatsApp via Twilio with template
approval sync · message templates · eject to Git / import · plugin SDK and
marketplace · runtime 2 and AI-assisted upgrades · "Sign in with Zuuvy" ·
cart with several products · the Zuuvy-side implementation of the contract.
