-- Commerce: variant groups, customers with accounts, discounts, and plugins
-- that take part in the cart and checkout.

-- ---------------------------------------------------------------------------
-- Variant groups. A group is one thing a customer shops for ("Linen shirt");
-- each product in it is one combination of its options (Colour × Size × Fit).
-- The group has its own photos, shown alongside the chosen variant's.
-- ---------------------------------------------------------------------------
create table product_groups (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  name         text not null,
  description  text not null default '',
  category     text,
  images       jsonb not null default '[]',
  -- [{ "name": "Colour", "values": ["Red", "Blue"] }, …] in display order
  options      jsonb not null default '[]',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on product_groups (tenant_id, name);

alter table products
  add column group_id uuid references product_groups(id) on delete set null,
  -- { "Colour": "Red", "Size": "M" }: this product's value for each of its group's options
  add column options jsonb not null default '{}';
create index on products (tenant_id, group_id);

-- ---------------------------------------------------------------------------
-- Customers of a business: they sign in on its stores, see their orders.
-- One account per business (the same person at two businesses is two
-- customers — neither business should see the other's).
-- ---------------------------------------------------------------------------
create table customers (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  email          text not null,
  name           text not null,
  phone          text,
  password_hash  text not null,
  address        text,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz
);
create unique index on customers (tenant_id, lower(email));

create table customer_sessions (
  token_hash   text primary key,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  customer_id  uuid not null references customers(id) on delete cascade,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);
create index on customer_sessions (customer_id);

-- ---------------------------------------------------------------------------
-- Discounts. No code = applied automatically when the rules hold.
-- ---------------------------------------------------------------------------
create table discounts (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  name               text not null,
  code               text,
  kind               text not null check (kind in ('percent', 'fixed')),
  value              numeric(12, 2) not null check (value > 0),
  -- which lines it counts: everything, or these products / groups / categories
  scope              text not null default 'all' check (scope in ('all', 'products', 'groups', 'categories')),
  scope_ids          jsonb not null default '[]',
  min_subtotal       numeric(12, 2),
  min_quantity       integer,
  max_amount         numeric(12, 2),
  starts_at          timestamptz,
  ends_at            timestamptz,
  usage_limit        integer,
  used_count         integer not null default 0,
  once_per_customer  boolean not null default false,
  first_order_only   boolean not null default false,
  -- applies together with the best non-stacking discount rather than instead of it
  stacks             boolean not null default false,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index on discounts (tenant_id, upper(code)) where code is not null;

create table discount_redemptions (
  discount_id  uuid not null references discounts(id) on delete cascade,
  order_id     uuid not null references orders(id) on delete cascade,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  customer_id  uuid references customers(id) on delete set null,
  phone        text,
  amount       numeric(12, 2) not null,
  created_at   timestamptz not null default now(),
  primary key (discount_id, order_id)
);

-- ---------------------------------------------------------------------------
-- Plugins: outside services the business connects to its cart and checkout.
-- Each is called with a signed request for the hooks it subscribes to.
-- ---------------------------------------------------------------------------
create table plugins (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  url         text not null,
  hooks       jsonb not null default '[]',
  secret      text not null,          -- sealed
  active      boolean not null default true,
  last_error  text,
  last_called_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Orders remember who placed them, what was taken off, and what plugins added.
alter table orders
  add column customer_id  uuid references customers(id) on delete set null,
  add column discount     numeric(12, 2) not null default 0,
  add column discounts    jsonb not null default '[]',
  add column adjustments  jsonb not null default '[]',
  add column extra        jsonb not null default '{}';
create index on orders (tenant_id, customer_id, created_at desc);

grant select, insert, update, delete on product_groups, customers, customer_sessions, discounts, plugins to zsite_app;
grant select, insert, delete on discount_redemptions to zsite_app;

alter table product_groups enable row level security;
create policy tenant_isolation on product_groups using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
alter table customers enable row level security;
create policy tenant_isolation on customers using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
alter table customer_sessions enable row level security;
create policy tenant_isolation on customer_sessions using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
alter table discounts enable row level security;
create policy tenant_isolation on discounts using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
alter table discount_redemptions enable row level security;
create policy tenant_isolation on discount_redemptions using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
alter table plugins enable row level security;
create policy tenant_isolation on plugins using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
