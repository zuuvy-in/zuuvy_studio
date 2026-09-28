-- AI usage, the media library, custom domains that actually connect, and the
-- platform's internal dashboard.
--
-- Expand-only: nothing here changes what 0001 code reads, so a deploy can run
-- old and new containers against it side by side.

-- ---------------------------------------------------------------------------
-- AI usage: one row per AI edit *attempt*, including the ones that saved
-- nothing. Tokens are spent whether or not a version comes out, so counting
-- only successful versions (site_versions.ai_meta) would under-report exactly
-- the edits somebody retried five times.
-- ---------------------------------------------------------------------------

create table ai_usage (
  id                  bigserial primary key,
  tenant_id           uuid not null references tenants(id) on delete cascade,
  user_id             uuid references users(id) on delete set null,
  site_id             uuid references sites(id) on delete set null,
  version_id          uuid references site_versions(id) on delete set null,
  provider            text not null,
  model               text not null,
  input_tokens        integer not null default 0,
  output_tokens       integer not null default 0,
  cache_read_tokens   integer not null default 0,
  requests            integer not null default 0,
  images              integer not null default 0,
  outcome             text not null check (outcome in ('version', 'no_change', 'refused', 'error')),
  error               text,
  created_at          timestamptz not null default now()
);
create index on ai_usage (tenant_id, created_at desc);
create index on ai_usage (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Media library: pictures a business uploaded or had generated. The bytes
-- live in object storage under a public URL (a site is public); the row is
-- what lets the studio list them and the AI know they exist.
-- ---------------------------------------------------------------------------

create table assets (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  site_id       uuid references sites(id) on delete set null,
  storage_key   text not null unique,
  url           text not null,
  kind          text not null check (kind in ('upload', 'generated')),
  content_type  text not null,
  bytes         integer not null,
  width         integer,
  height        integer,
  alt           text not null default '',
  prompt        text,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index on assets (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Custom domains: what connecting one needs. The certificate is requested in
-- the platform's AWS account; the business proves the domain is theirs by
-- adding the validation CNAME, and points it at us with a second CNAME.
-- ---------------------------------------------------------------------------

alter table site_domains
  add column certificate_arn   text,
  add column validation_name   text,
  add column validation_value  text,
  add column attached          boolean not null default false,
  add column last_error        text,
  add column checked_at        timestamptz,
  add column verified_at       timestamptz,
  add column created_by        uuid references users(id) on delete set null;
create index on site_domains (tenant_id, site_id);

-- ---------------------------------------------------------------------------
-- Brand kit, per site: logo, colours, fonts, motion, guidelines. What the
-- owner sets here is fixed — the AI works around it and never changes it;
-- what is left empty the AI chooses (recorded under "aiColors").
-- ---------------------------------------------------------------------------

alter table sites add column brand jsonb not null default '{}'::jsonb;

-- Deleting a site demands a fresh export first: the time of the last export
-- and how many versions it held. A version made after the export makes it
-- stale, so what is deleted is never more than what was downloaded.
alter table sites
  add column exported_at   timestamptz,
  add column exported_seq  integer;

-- Where a store's products and stock come from:
--   studio  products and stock managed here, in Zuuvy Studio (source 'native');
--           accepting an order takes its quantities off stock
--   source  a connected data source (inventory_source, e.g. 'zuuvy') owns them
--   none    products managed here, stock not tracked — nothing is ever sold out
-- Existing stores keep what they did: products from Zuuvy.
alter table sites
  add column inventory         text not null default 'source' check (inventory in ('studio', 'source', 'none')),
  add column inventory_source  text default 'zuuvy';

-- ---------------------------------------------------------------------------
-- GitHub sync, per site: every new version is pushed as a branch
-- (zuuvy/v<n>), and publishing a version merges its branch into the default
-- branch. The token is sealed like every other credential (secrets.ts).
-- ---------------------------------------------------------------------------

create table site_git (
  site_id          uuid primary key references sites(id) on delete cascade,
  tenant_id        uuid not null references tenants(id) on delete cascade,
  owner            text not null,
  repo             text not null,
  default_branch   text not null default 'main',
  credentials      text not null,
  status           text not null default 'active' check (status in ('active', 'error')),
  last_error       text,
  last_synced_at   timestamptz,
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now()
);
alter table site_git enable row level security;
create policy tenant_isolation on site_git using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update, delete on site_git to zsite_app;

-- ---------------------------------------------------------------------------
-- Site data (profile, projects, experience…) is part of a version, like the
-- tree: immutable, so every version is also the backup of the data as it
-- stood, and going back can reset any collection from it.
-- ---------------------------------------------------------------------------

alter table site_versions add column data jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Email alerts, per business: { "orders": true, "emails": ["owner@…"] }.
-- Set during onboarding and under Settings; read when an order arrives.
-- ---------------------------------------------------------------------------

alter table tenants add column alerts jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- RLS and grants for the new tables.
-- ---------------------------------------------------------------------------

alter table ai_usage enable row level security;
create policy tenant_isolation on ai_usage using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
alter table assets enable row level security;
create policy tenant_isolation on assets using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());

-- Usage is a ledger: written once, never edited.
grant select, insert on ai_usage to zsite_app;
grant select, insert, update, delete on assets to zsite_app;
grant usage, select on all sequences in schema public to zsite_app;

-- A hostname may only be claimed once across the platform; the studio asks
-- before inserting so the refusal can name the problem.
create or replace function domain_taken(p_hostname text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from site_domains where hostname = lower(p_hostname))
$$;

-- ---------------------------------------------------------------------------
-- The internal dashboard. These read across every tenant, so they are the
-- widest doors in the schema: aggregates and version metadata only — never a
-- site tree, a credential or an order. Who may call them is decided in the
-- studio: a row in platform_admins (which the application cannot write).
-- ---------------------------------------------------------------------------

-- Platform admins: the people who run Zuuvy Sites itself. The application
-- may read the list but not write it; changes go through the functions
-- below, which check in the database that the person asking is a
-- superadmin. scripts/create-superadmin.ts seeds the first one.
create table platform_admins (
  user_id     uuid primary key references users(id) on delete cascade,
  role        text not null check (role in ('superadmin', 'admin')),
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);
grant select on platform_admins to zsite_app;

create or replace function grant_platform_admin(p_actor uuid, p_user uuid, p_role text)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists (select 1 from platform_admins where user_id = p_actor and role = 'superadmin') then
    raise exception 'only a superadmin can add platform admins' using errcode = '42501';
  end if;
  if p_role not in ('superadmin', 'admin') then
    raise exception 'unknown role %', p_role using errcode = '22023';
  end if;
  insert into platform_admins (user_id, role, created_by) values (p_user, p_role, p_actor)
  on conflict (user_id) do update set role = excluded.role;
end $$;

create or replace function revoke_platform_admin(p_actor uuid, p_user uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists (select 1 from platform_admins where user_id = p_actor and role = 'superadmin') then
    raise exception 'only a superadmin can remove platform admins' using errcode = '42501';
  end if;
  if p_actor = p_user then
    raise exception 'you cannot remove yourself' using errcode = '22023';
  end if;
  if (select role from platform_admins where user_id = p_user) = 'superadmin'
     and (select count(*) from platform_admins where role = 'superadmin') <= 1 then
    raise exception 'the last superadmin cannot be removed' using errcode = '22023';
  end if;
  delete from platform_admins where user_id = p_user;
end $$;

create or replace function admin_user_overview(p_since timestamptz)
returns table (
  user_id uuid, email text, name text, created_at timestamptz, last_seen timestamptz,
  businesses text[], sites bigint, versions bigint, ai_versions bigint,
  ai_attempts bigint, input_tokens bigint, output_tokens bigint, images bigint,
  period_input_tokens bigint, period_output_tokens bigint, period_attempts bigint
)
language sql stable security definer set search_path = public as $$
  select u.id, u.email::text, u.name, u.created_at,
    (select max(s.created_at) from sessions s where s.user_id = u.id),
    coalesce((select array_agg(t.name order by t.name) from memberships m join tenants t on t.id = m.tenant_id where m.user_id = u.id), '{}'),
    (select count(distinct st.id) from memberships m join sites st on st.tenant_id = m.tenant_id where m.user_id = u.id),
    (select count(*) from site_versions v where v.created_by = u.id),
    (select count(*) from site_versions v where v.created_by = u.id and v.source = 'ai'),
    coalesce(a.attempts, 0), coalesce(a.input_tokens, 0), coalesce(a.output_tokens, 0), coalesce(a.images, 0),
    coalesce(a.period_input, 0), coalesce(a.period_output, 0), coalesce(a.period_attempts, 0)
  from users u
  left join lateral (
    select count(*) as attempts,
      sum(x.input_tokens) as input_tokens, sum(x.output_tokens) as output_tokens, sum(x.images) as images,
      sum(x.input_tokens) filter (where x.created_at >= p_since) as period_input,
      sum(x.output_tokens) filter (where x.created_at >= p_since) as period_output,
      count(*) filter (where x.created_at >= p_since) as period_attempts
    from ai_usage x where x.user_id = u.id
  ) a on true
  order by coalesce(a.period_input, 0) + coalesce(a.period_output, 0) desc, u.created_at desc
$$;

create or replace function admin_user_versions(p_user uuid, p_limit integer)
returns table (
  version_id uuid, business text, site_name text, subdomain text, number integer,
  source text, prompt text, summary text, published boolean, created_at timestamptz,
  input_tokens integer, output_tokens integer
)
language sql stable security definer set search_path = public as $$
  select v.id, t.name, s.name, s.subdomain, v.number, v.source, v.prompt, v.summary,
    s.published_version_id = v.id, v.created_at,
    coalesce(u.input_tokens, 0), coalesce(u.output_tokens, 0)
  from site_versions v
  join sites s on s.id = v.site_id
  join tenants t on t.id = v.tenant_id
  left join ai_usage u on u.version_id = v.id
  where v.created_by = p_user
  order by v.created_at desc
  limit least(greatest(p_limit, 1), 500)
$$;

create or replace function admin_user_attempts(p_user uuid, p_limit integer)
returns table (
  created_at timestamptz, business text, site_name text, outcome text, error text,
  provider text, model text, input_tokens integer, output_tokens integer, images integer, requests integer
)
language sql stable security definer set search_path = public as $$
  select x.created_at, t.name, s.name, x.outcome, x.error, x.provider, x.model,
    x.input_tokens, x.output_tokens, x.images, x.requests
  from ai_usage x
  join tenants t on t.id = x.tenant_id
  left join sites s on s.id = x.site_id
  where x.user_id = p_user
  order by x.created_at desc
  limit least(greatest(p_limit, 1), 500)
$$;

create or replace function admin_totals(p_since timestamptz)
returns table (
  users bigint, businesses bigint, sites bigint, published_sites bigint, versions bigint,
  ai_attempts bigint, input_tokens bigint, output_tokens bigint, images bigint,
  period_attempts bigint, period_input_tokens bigint, period_output_tokens bigint,
  domains bigint, active_domains bigint
)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from users),
    (select count(*) from tenants),
    (select count(*) from sites),
    (select count(*) from sites where published_version_id is not null),
    (select count(*) from site_versions),
    (select count(*) from ai_usage),
    (select coalesce(sum(input_tokens), 0) from ai_usage),
    (select coalesce(sum(output_tokens), 0) from ai_usage),
    (select coalesce(sum(images), 0) from ai_usage),
    (select count(*) from ai_usage where created_at >= p_since),
    (select coalesce(sum(input_tokens), 0) from ai_usage where created_at >= p_since),
    (select coalesce(sum(output_tokens), 0) from ai_usage where created_at >= p_since),
    (select count(*) from site_domains),
    (select count(*) from site_domains where status = 'active')
$$;

revoke all on function domain_taken(text), admin_user_overview(timestamptz), admin_user_versions(uuid, integer),
  admin_user_attempts(uuid, integer), admin_totals(timestamptz), grant_platform_admin(uuid, uuid, text),
  revoke_platform_admin(uuid, uuid) from public;
grant execute on function domain_taken(text), admin_user_overview(timestamptz), admin_user_versions(uuid, integer),
  admin_user_attempts(uuid, integer), admin_totals(timestamptz), grant_platform_admin(uuid, uuid, text),
  revoke_platform_admin(uuid, uuid) to zsite_app;
