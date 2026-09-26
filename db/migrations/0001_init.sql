-- Zuuvy Sites — initial schema.
--
-- One database, shared tables, a tenant_id on every tenant-owned row, and
-- Postgres Row-Level Security as the backstop. The application connects as
-- `zsite_app`, which owns nothing, cannot bypass RLS, and sees only the rows
-- of the tenant named by `app.tenant_id` for the current transaction
-- (set by `withTenant()` in packages/platform/src/db.ts). A query that forgets
-- its WHERE tenant_id = … therefore returns nothing rather than another
-- business's rows. Zuuvy's backend learned that lesson twice with filters
-- that lived only in application code.
--
-- The handful of lookups that must cross tenants — which site a Host names,
-- which integration a webhook URL names, claiming queued jobs — are
-- SECURITY DEFINER functions at the bottom, each returning the minimum.

create extension if not exists pgcrypto;
create extension if not exists citext;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'zsite_app') then
    create role zsite_app nologin;
  end if;
end $$;

create or replace function app_tenant() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- Identity is global; membership is per tenant (the Zuuvy model: one person,
-- one login, several businesses).
-- ---------------------------------------------------------------------------

create table tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  plan        text not null default 'starter',
  order_seq   integer not null default 0,
  created_at  timestamptz not null default now()
);

create table users (
  id             uuid primary key default gen_random_uuid(),
  email          citext not null unique,
  name           text not null,
  password_hash  text not null,
  created_at     timestamptz not null default now()
);

create table memberships (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  role       text not null check (role in ('owner', 'admin', 'editor')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- Only a hash of the cookie is stored, so a leaked table is not a set of sessions.
create table sessions (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sites and versions
-- ---------------------------------------------------------------------------

create table sites (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  name                  text not null,
  kind                  text not null check (kind in ('landing', 'portfolio', 'store')),
  subdomain             text not null unique,
  runtime_version       text not null default '1',
  published_version_id  uuid,
  version_seq           integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on sites (tenant_id);

-- A version is immutable: the app role may insert and read, never update or
-- delete (grants below). Publishing and rolling back move a pointer on
-- `sites`; they never touch a version.
create table site_versions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  site_id          uuid not null references sites(id) on delete cascade,
  number           integer not null,
  parent_id        uuid references site_versions(id),
  mode             text not null default 'managed' check (mode in ('managed', 'code')),
  tree             jsonb,
  git_ref          text,
  runtime_version  text not null,
  source           text not null check (source in ('template', 'ai', 'manual', 'restore', 'import')),
  prompt           text,
  summary          text not null default '',
  ai_meta          jsonb,
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (site_id, number),
  check ((mode = 'managed' and tree is not null) or (mode = 'code' and git_ref is not null))
);
create index on site_versions (tenant_id, site_id, number desc);

alter table sites
  add constraint sites_published_version_fk
  foreign key (published_version_id) references site_versions(id);

create table site_publications (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  site_id               uuid not null references sites(id) on delete cascade,
  version_id            uuid not null references site_versions(id),
  previous_version_id   uuid references site_versions(id),
  published_by          uuid references users(id) on delete set null,
  published_at          timestamptz not null default clock_timestamp()
);
create index on site_publications (tenant_id, site_id, published_at desc);

-- Custom domains. Resolution already honours verified rows; connecting them
-- (Route 53 registration, Domain Connect, CloudFront SaaS Manager) comes next.
create table site_domains (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  site_id     uuid not null references sites(id) on delete cascade,
  hostname    text not null unique,
  status      text not null default 'pending' check (status in ('pending', 'verifying', 'active', 'failed')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Integrations
-- ---------------------------------------------------------------------------

create table integrations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  kind            text not null,
  status          text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  config          jsonb not null default '{}',
  secrets         text,              -- sealed by packages/platform/src/secrets.ts
  last_sync_at    timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, kind)
);

-- Append-only: the log of everything that crossed the boundary, both ways.
create table integration_events (
  id              bigserial primary key,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  integration_id  uuid not null references integrations(id) on delete cascade,
  direction       text not null check (direction in ('in', 'out')),
  topic           text not null,
  status          text not null check (status in ('ok', 'error', 'ignored', 'duplicate')),
  summary         text not null default '',
  delivery_id     text,
  payload         jsonb,
  created_at      timestamptz not null default now()
);
create index on integration_events (tenant_id, integration_id, id desc);
create unique index integration_events_delivery on integration_events (integration_id, delivery_id)
  where delivery_id is not null and direction = 'in' and status <> 'duplicate';

-- ---------------------------------------------------------------------------
-- Commerce
-- ---------------------------------------------------------------------------

create table products (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  source       text not null check (source in ('native', 'zuuvy')),
  external_id  text,
  name         text not null,
  description  text not null default '',
  category     text,
  price        numeric(12, 2),
  mrp          numeric(12, 2),
  currency     text not null default 'INR',
  unit_label   text,
  images       jsonb not null default '[]',
  in_stock     boolean not null default true,
  stock        numeric(14, 3),
  active       boolean not null default true,
  synced_at    timestamptz,
  updated_at   timestamptz not null default now(),
  unique (tenant_id, source, external_id)
);
create index on products (tenant_id, active, name);

create table orders (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  site_id          uuid references sites(id) on delete set null,
  number           integer not null,
  public_token     text not null unique,
  status           text not null default 'pending'
                   check (status in ('pending', 'confirmed', 'rejected', 'packed', 'shipped', 'delivered', 'cancelled')),
  payment_method   text not null check (payment_method in ('cod', 'online')),
  payment_status   text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'refunded')),
  customer         jsonb not null,
  lines            jsonb not null,
  subtotal         numeric(12, 2) not null,
  total            numeric(12, 2) not null,
  currency         text not null default 'INR',
  note             text,
  external_ref     text,
  external_status  text,
  sync_state       text not null default 'not_linked'
                   check (sync_state in ('not_linked', 'pending', 'sent', 'failed')),
  sync_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, number)
);
create index on orders (tenant_id, created_at desc);

create table order_events (
  id          bigserial primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  order_id    uuid not null references orders(id) on delete cascade,
  status      text not null,
  note        text not null default '',
  source      text not null,
  created_at  timestamptz not null default now()
);
create index on order_events (tenant_id, order_id, id);

-- ---------------------------------------------------------------------------
-- Outbox: work that must happen after a commit and survive a crash — posting
-- an order to Zuuvy, a catalogue sync. A worker drains it (SQS in production).
-- ---------------------------------------------------------------------------

create table outbox (
  id          bigserial primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  topic       text not null,
  payload     jsonb not null,
  status      text not null default 'pending' check (status in ('pending', 'running', 'done', 'dead')),
  attempts    integer not null default 0,
  run_after   timestamptz not null default now(),
  locked_at   timestamptz,
  last_error  text,
  created_at  timestamptz not null default now()
);
create index outbox_due on outbox (run_after) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'sites', 'site_versions', 'site_publications', 'site_domains',
    'integrations', 'integration_events', 'products', 'orders', 'order_events', 'outbox'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())',
      t);
  end loop;
end $$;

-- tenants: a tenant can read and update itself only.
alter table tenants enable row level security;
create policy tenant_self on tenants using (id = app_tenant()) with check (id = app_tenant());

grant usage on schema public to zsite_app;
grant select, insert, update, delete on
  sites, site_publications, site_domains, integrations, products, orders, outbox
  to zsite_app;
grant select, insert on site_versions, integration_events, order_events to zsite_app;
grant select, update on tenants to zsite_app;
grant usage, select on all sequences in schema public to zsite_app;
-- Global identity tables are not tenant-owned; the app reads and writes them
-- directly (a person is one account across every business).
grant select, insert, update, delete on users, memberships, sessions to zsite_app;

-- ---------------------------------------------------------------------------
-- Cross-tenant doors. SECURITY DEFINER runs as the migration owner — the
-- tables' owner, whom RLS does not bind (row security is enabled, not
-- forced, precisely so this works). Each returns ids, never rows.
-- ---------------------------------------------------------------------------

create or replace function resolve_site_by_subdomain(p_subdomain text)
returns table (tenant_id uuid, site_id uuid)
language sql stable security definer set search_path = public as $$
  select s.tenant_id, s.id from sites s where s.subdomain = lower(p_subdomain)
$$;

create or replace function resolve_site_by_domain(p_hostname text)
returns table (tenant_id uuid, site_id uuid)
language sql stable security definer set search_path = public as $$
  select d.tenant_id, d.site_id from site_domains d
  where d.hostname = lower(p_hostname) and d.status = 'active'
$$;

create or replace function resolve_integration(p_id uuid)
returns table (tenant_id uuid, kind text)
language sql stable security definer set search_path = public as $$
  select i.tenant_id, i.kind from integrations i where i.id = p_id
$$;

create or replace function resolve_order_token(p_token text)
returns table (tenant_id uuid, order_id uuid)
language sql stable security definer set search_path = public as $$
  select o.tenant_id, o.id from orders o where o.public_token = p_token
$$;

create or replace function subdomain_taken(p_subdomain text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from sites where subdomain = lower(p_subdomain))
$$;

create or replace function create_tenant(p_slug text, p_name text)
returns uuid
language sql volatile security definer set search_path = public as $$
  insert into tenants (slug, name) values (p_slug, p_name) returning id
$$;

-- Claims due jobs for a worker: marks them running and hands back their
-- tenant, so the worker then does the work inside that tenant's context.
-- A job left 'running' for five minutes (a crashed worker) is claimable again.
create or replace function claim_outbox(p_limit integer)
returns table (id bigint, tenant_id uuid, topic text, payload jsonb, attempts integer)
language sql volatile security definer set search_path = public as $$
  update outbox o set status = 'running', locked_at = now(), attempts = o.attempts + 1
  where o.id in (
    select id from outbox
    where (status = 'pending' and run_after <= now())
       or (status = 'running' and locked_at < now() - interval '5 minutes')
    order by run_after
    limit p_limit
    for update skip locked
  )
  returning o.id, o.tenant_id, o.topic, o.payload, o.attempts
$$;

revoke all on function resolve_site_by_subdomain(text), resolve_site_by_domain(text),
  resolve_integration(uuid), resolve_order_token(text), subdomain_taken(text),
  create_tenant(text, text), claim_outbox(integer) from public;
grant execute on function resolve_site_by_subdomain(text), resolve_site_by_domain(text),
  resolve_integration(uuid), resolve_order_token(text), subdomain_taken(text),
  create_tenant(text, text), claim_outbox(integer), app_tenant() to zsite_app;
