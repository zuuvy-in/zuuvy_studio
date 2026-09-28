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

## Design helpers (MCP)

The editor's tools are the site tools plus whatever MCP servers are connected
(`packages/ai/src/mcp/`). Each MCP tool becomes a `SiteTool` named
`<server>__<tool>` carrying the server's JSON Schema, so both providers send it
unchanged and a tool's own error goes back to the model like any other.

- **Design kit** (`mcp/design-kit.ts`), always on, connected in-process:
  `palette` (the theme's six colours from one brand colour, contrast-checked),
  `check_contrast`, `font_pairings` (from the tree's font list),
  `style_recipe` (fonts, radius, motion, imagery, copy and a section order in
  this builder's section types), and `search_photos` (Unsplash or Pexels, only
  with a key) whose https URLs go straight into image fields. Its answers are
  suggestions: `set_theme` and `applyBrand` still keep what the brand kit fixes.
  `npm run mcp:design-kit -w @zsite/ai` serves it over stdio for other clients.
- **Remote servers** from `ZSITE_MCP_SERVERS` (streamable HTTP only). The URLs
  come from the deployment, never from users or the model. A server that is
  down is skipped with a warning; an edit never fails for an optional helper.

## Model fallback

A model the account cannot use (Bedrock AccessDenied / ResourceNotFound /
Validation, Anthropic 403/404) fails before it edits anything, so `editSite`
reruns the request on `ZSITE_AI_FALLBACK_MODEL` (default: the provider's
default model) and says so in the version summary. Usage from both attempts is
recorded.

## Plan first

A request can be one line. With "Plan first" on (the composer's default),
`planVersion` → `planSite` (`packages/ai/src/plan.ts`) shows the model the same
facts the builder sees, plus the design kit and reference fetching but none of
the editing tools, and has it call `submit_plan` with pages, sections, look,
imagery, its assumptions and at most three questions. Nothing is edited and no
version is made; the plan is metered in `ai_usage` as outcome `plan`. The
owner approves it, with optional notes or answers, and `generateVersion` builds
the request plus `planBrief(plan, notes)`. The plan goes to the browser and
back, so `parsePlan` validates it again. The version keeps the owner's own
request as its prompt. The planning call is made outside the form's action so
any attached files are still in the form for the build.

## Out-of-stock products

`sites.out_of_stock` (per store): `show` lists them as out of stock and refuses
orders (the default); `hide` leaves them off the storefront; `sell` keeps
taking orders ("Made to order"). In `sell`, accepting an order takes whatever
stock there is, down to zero, and records it in `orders.stock_taken`;
cancelling puts back exactly that. It has no effect when stock is not counted.
With a data source (Zuuvy) the order still goes there, and it may refuse.

## Commerce: variants, cart, checkout, accounts, discounts, plugins

**Variant groups** (`platform/src/groups.ts`, `product_groups`, `products.group_id` + `products.options`).
A group is one thing to shop for; each product in it is one combination of the
group's options (up to 4 options, 200 combinations). Groups are filled by
generating every combination (`generateVariants`) or by grouping existing
products and setting each one's combination (`setVariants`, which refuses two
products for one combination). The storefront shows a group as one card
(`runtime productCards`: lowest price, "from", in stock if any variant is) and
one page, `/g/<id>`, where the options pick the variant; its pictures come
first, then the group's. `jsonb` does not keep key order, so a variant's label
is always built in the group's option order (`variantLabel`).

**Cart and checkout** (`platform/src/cart.ts`, `apps/renderer/app/{cart,checkout}`).
The cart is a cookie of product ids and quantities on the store's own host;
every price is worked out again on the server (`quoteCart`). `checkout` quotes
with plugins, reads the answers to plugin questions, lets `checkout.validate`
refuse, and calls `placeOrder`, whose transaction re-decides the discounts from
the rules as they stand and redeems them with a conditional update, so the last
use of a limited code goes to one order. Payment is cash on delivery.

**How it looks is the AI's decision** (`tree.commerce`, op `setCommerce`, tool
`set_commerce`, stores only): cart as a drawer or a page, bag/cart/basket icon,
in the header or floating; add to cart, buy now or both; checkout on one page
or in steps, summary beside or above, note field, heading, a reassurance line;
the account link in the header or footer. Absent reads as `DEFAULT_COMMERCE`.
The drawer opens on `?cart=open` (rendered open by the server) or `#cart`.

**Customer accounts** (`platform/src/customers.ts`, `/account`). Email and
password per business — the same email at two businesses is two customers.
Sessions are hashed tokens in `customer_sessions`, in a cookie on the store's
host. Orders are linked only when placed while signed in; a phone number is not
proof of identity, so earlier orders are never attached by it. The account
lists orders with their status and each order's timeline.

**Discounts** (`platform/src/discounts.ts`). Automatic (no code) or by code;
scope all / products / groups / categories; minimum spend and quantity on the
scoped lines; cap; dates; usage limit; once per customer (account or phone);
first order only. One non-stacking discount applies — the best for the
customer — plus any marked `stacks`. Per-customer rules are checked at
checkout, when the buyer is known.

**Plugins** (`platform/src/plugins.ts`, `docs/PLUGINS.md`). Signed https calls
for `cart.calculate`, `checkout.fields`, `checkout.validate` and `order.placed`
(the last through the outbox). They go through `references.postJson` — the same
SSRF guard as reference fetching, https only, no redirects, 3 s, 64 KB. A
failing plugin is skipped and its error kept; it can shape a sale, never break
one.

## Design range, icons and skills

**Section styles** (`core SectionStyle`, op `styleSection`, tool `style_section`). Every section can carry a
style beside its props: background (default, surface, primary, dark, gradient, mesh, image), pattern
(dots, grid, noise), divider (wave, slant, curve — the section's bottom edge), spacing and its scroll entrance.
The runtime wraps each section in `.zs-block` carrying these as data attributes; dark, primary, gradient and
image backgrounds redefine the colour variables inside the section, so every block inverts correctly without
knowing it. Optional, so older trees are unchanged.

**Richer blocks**: hero layouts (classic, split, fullbleed, stacked), backdrops, a gradient `highlight`, rotating
words and proof badges; features layouts (cards, bento, icons, list) with icons; imageText bullets, eyebrow and a
floating badge; gallery masonry and carousel; testimonials marquee and spotlight with ratings; stats that count up;
CTA styles (banner, glow, split, minimal); new `logos`, `marquee` and `steps` blocks. All CSS, no client script;
motion respects `prefers-reduced-motion` and the theme's motion setting, and anything a browser cannot animate is
drawn in its final state.

**Icons**: an `icon` field is a Lucide name (drawn inline by `runtime/src/icons.tsx` from the bundled
`@iconify-json/lucide` set) or an https picture from an icon service (e.g. Icons8 through a remote MCP server).
The editor refuses names that do not exist with suggestions (`ai/src/icons.ts`); `design__search_icons` finds
names by meaning, locally and through Iconify's public search when reachable.

**Skills** (`ai/src/skills.ts`): web design, content and animation guidance written for these blocks. They are
part of the build and plan prompts, and the design kit serves them as MCP prompts and a `skill` tool.
