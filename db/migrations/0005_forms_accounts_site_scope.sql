-- Forms and the tables they fill; customer accounts as a per-site choice; and
-- store data (products, groups, discounts, plugins, customers) tied to a site.

-- ---------------------------------------------------------------------------
-- Site tables: somewhere a form's answers go. The AI creates them alongside
-- the form that fills them; the owner reads, exports and deletes rows.
-- ---------------------------------------------------------------------------
create table site_tables (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  site_id     uuid not null references sites(id) on delete cascade,
  key         text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  name        text not null,
  -- [{ "key": "email", "label": "Email", "type": "email" }, …]
  columns     jsonb not null default '[]',
  -- email the business's alert addresses on each new row
  notify      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (site_id, key)
);

create table site_table_rows (
  id          bigserial primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  table_id    uuid not null references site_tables(id) on delete cascade,
  data        jsonb not null,
  -- the page the form was on, for context
  page        text,
  created_at  timestamptz not null default now()
);
create index on site_table_rows (table_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Accounts: whether a site lets visitors sign up and sign in. Stores had them
-- implicitly; now any site may, and the owner decides.
-- ---------------------------------------------------------------------------
alter table sites add column accounts boolean not null default false;
update sites set accounts = true where kind = 'store';

-- ---------------------------------------------------------------------------
-- Store data belongs to a site. NULL keeps a row shared by every store of the
-- business, which is what all existing rows were; a business with exactly one
-- store has its rows moved to it, so each site's pages show what they sell.
-- ---------------------------------------------------------------------------
alter table products       add column site_id uuid references sites(id) on delete set null;
alter table product_groups add column site_id uuid references sites(id) on delete set null;
alter table discounts      add column site_id uuid references sites(id) on delete cascade;
alter table plugins        add column site_id uuid references sites(id) on delete cascade;
alter table customers      add column site_id uuid references sites(id) on delete set null;
create index on products (tenant_id, site_id);

with only_store as (
  select tenant_id, (array_agg(id))[1] as site_id from sites where kind = 'store' group by tenant_id having count(*) = 1
)
update products p set site_id = o.site_id from only_store o where p.tenant_id = o.tenant_id and p.source = 'native' and p.site_id is null;
with only_store as (
  select tenant_id, (array_agg(id))[1] as site_id from sites where kind = 'store' group by tenant_id having count(*) = 1
)
update product_groups g set site_id = o.site_id from only_store o where g.tenant_id = o.tenant_id and g.site_id is null;

grant select, insert, update, delete on site_tables to zsite_app;
grant select, insert, delete on site_table_rows to zsite_app;
grant usage, select on sequence site_table_rows_id_seq to zsite_app;

alter table site_tables enable row level security;
create policy tenant_isolation on site_tables using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
alter table site_table_rows enable row level security;
create policy tenant_isolation on site_table_rows using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
