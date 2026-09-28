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
| AI models | Only models covered by AWS startup credits to begin with: Amazon Nova on Bedrock. Claude stays a one-setting switch (`ZSITE_AI_PROVIDER=anthropic`) |

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

### Data travels with the version

Structured content — a portfolio's profile, projects, experience, education,
skills, services, testimonials, awards, publications, clients, gallery — lives
in `site_versions.data` beside the tree (`core/src/data.ts`), shown by
`collection` sections. Because it is part of an immutable version, the
version a change was made on *is* the backup of the data before it, and
restoring a version asks which tables to reset from it (and whether to bring
the layout back). The Content editor saves each edit as a new version.

### The brand kit

`sites.brand` (`core/src/brand.ts`): logo, colours, fonts, motion, guidelines.
What the owner sets is fixed — `set_theme` keeps those fields and tells the
model so, and `applyBrand` runs over every AI version as the guarantee. What
the owner leaves empty the AI chooses; its choices are recorded (`aiColors`).
Saving the kit creates a version with it applied.

### Getting a site in and out

- Site export (zip, `platform/src/archive.ts`): every version and its data,
  pictures, publications, domains and the site's orders. **Deleting a site
  requires one** downloaded after its newest version (`sites.exported_at`,
  `exported_seq`), under 24 hours old.
- Revision source (`core/src/source.ts`): one version as plain JSON files
  (pages, theme, nav, footer, `site/data/*.json`). Edited and zipped, it comes
  back as a new version, validated in full with the file and field named.
- GitHub (`platform/src/git.ts`): each version is pushed as branch
  `zuuvy/v<n>`; publishing makes the default branch that version with a merge
  commit whose tree is the published version (so a rollback rolls `main`
  back too); any branch can be imported as a version.

## AI

`packages/ai`: one tool per operation plus `view_site`, defined once
(`tools.ts`) with no provider in them — each validates its own input, so a
weaker model's bad call is an error it corrects, never a broken site. The
system prompt carries every block's JSON schema (generated from the same zod
schemas that validate the tree). Output is always a **new unpublished
version** parented on the one the owner was looking at.

Providers (`providers/`), chosen by `ZSITE_AI_PROVIDER`:

| Provider | Model (default) | Why |
|---|---|---|
| `bedrock` (default) | Amazon Nova Pro via the Converse API, `apac.amazon.nova-pro-v1:0` | AWS's own model family: covered by AWS promotional credits. Any Bedrock model with tool use works via `ZSITE_AI_MODEL`, e.g. Nova Premier (`us.amazon.nova-premier-v1:0`, US regions) for harder edits. |
| `anthropic` | Claude (`claude-opus-5`) via the Anthropic SDK tool runner | Stronger multi-step editing; for when budget or credits allow. |

Beyond the tree, the agent can:

- **edit data** (`add_entry`, `update_entry`, `remove_entry`, `move_entry`).
  Adding and filling empty fields apply at once; **changing or removing
  what exists is held as a proposal** (`ai_meta.proposals`) the owner allows
  on the version page, applied as a new version;
- **make pictures** (`generate_image`, Amazon Nova 2 Omni on Bedrock, stored
  in the media library, steered to the brand palette, 4 per request);
- **look at reference websites** (`fetch_reference`: a guarded fetch —
  public addresses only, pinned DNS, re-checked redirects — reduced to
  headings, sections, colours and fonts);
- **read attachments** — PDF, Word, Excel, CSV, text and screenshots go to
  the model as Converse document/image blocks, for that request only.

Every attempt is a row in `ai_usage` (tokens, pictures, outcome — including
failures), shown per person under AI usage and across the platform in the
internal dashboard (`/admin`, for rows in `platform_admins`).

Credentials for Bedrock come from the AWS SDK chain (profile or keys locally,
the service's IAM role in production). Sampling is near-greedy
(`temperature: 0`), which AWS recommends for Nova tool use. Before relying on
one model over another, measure the edit success rate on real prompts — a
failed edit shows up as "the AI made no changes".

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

## AWS deployment

What runs today is in `docs/DEPLOYMENT.md` (CDK in `infra/`, deployed by
GitHub Actions over OIDC): ALB + Fargate + Aurora Serverless v2 in
`ap-south-1`. The fuller target below adds CloudFront for custom domains.

### Target

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
- **Custom domains (built, on the load balancer)**: the owner adds a validation
  CNAME and a CNAME to `domains.zuuvy.site`; the worker requests an ACM
  certificate, attaches it to the HTTPS listener (SNI; 25 per listener by
  default, raisable), and marks the domain active once DNS points at us
  (`platform/src/domains.ts`). Buying domains through Route 53 comes later.

## Not built yet

Payment gateways (Razorpay/Cashfree; default
gateway via split settlement, flat fee) · WhatsApp via Twilio with template
approval sync · message templates · running custom React code (source export covers content and layout) · plugin SDK and
marketplace · runtime 2 and AI-assisted upgrades · "Sign in with Zuuvy" ·
cart with several products · the Zuuvy-side implementation of the contract.
