-- Premade sites: real, published sites on the platform's own account that any
-- business can fork as its starting point. Listed and read through the doors
-- below, which hand out only a showcase's published version — never anything
-- else of the account that hosts it.
create table showcases (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null unique references sites(id) on delete cascade,
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  title       text not null,
  category    text not null default '',
  description text not null default '',
  cover_url   text,
  -- the business name the sample text uses, swapped for the customer's own on a fork
  sample_business text not null default '',
  sort        integer not null default 0,
  active      boolean not null default true,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Like platform_admins: the application reads, and writes only through the
-- functions, which check the caller is a platform admin in the database.
grant select on showcases to zsite_app;

create or replace function list_showcases(p_all boolean default false)
returns table (id uuid, slug text, title text, category text, description text, cover_url text, sort integer, active boolean,
               sample_business text, site_id uuid, kind text, subdomain text, published boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.slug, c.title, c.category, c.description, c.cover_url, c.sort, c.active, c.sample_business,
         s.id, s.kind, s.subdomain, s.published_version_id is not null
    from showcases c join sites s on s.id = c.site_id
   where p_all or (c.active and s.published_version_id is not null)
   order by c.sort, c.title
$$;

-- What a fork copies: the published version, the brand kit and the form tables' shapes.
create or replace function showcase_source(p_id uuid)
returns table (kind text, name text, sample_business text, tree jsonb, data jsonb, brand jsonb, tables jsonb)
language sql stable security definer set search_path = public as $$
  select s.kind, s.name, c.sample_business, v.tree, v.data, s.brand,
         coalesce((select jsonb_agg(jsonb_build_object('key', t.key, 'name', t.name, 'columns', t.columns, 'notify', t.notify))
                     from site_tables t where t.site_id = s.id), '[]'::jsonb)
    from showcases c
    join sites s on s.id = c.site_id
    join site_versions v on v.id = s.published_version_id
   where c.id = p_id and c.active
$$;

-- A store showcase's own sample products, to start the fork's catalogue.
create or replace function showcase_products(p_id uuid)
returns table (name text, description text, category text, price numeric, mrp numeric, images jsonb, unit_label text)
language sql stable security definer set search_path = public as $$
  select p.name, p.description, p.category, p.price, p.mrp, p.images, p.unit_label
    from showcases c join products p on p.site_id = c.site_id
   where c.id = p_id and c.active and p.source = 'native' and p.active
   order by p.name
   limit 100
$$;

create or replace function set_showcase(p_actor uuid, p_site uuid, p_slug text, p_title text, p_category text,
                                        p_description text, p_cover text, p_sort integer, p_active boolean, p_sample text)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from platform_admins where user_id = p_actor) then
    raise exception 'only platform admins manage premade sites' using errcode = '42501';
  end if;
  -- A showcase is one of the admin's own business's sites, never a customer's.
  if not exists (select 1 from sites s join memberships m on m.tenant_id = s.tenant_id where s.id = p_site and m.user_id = p_actor) then
    raise exception 'that site is not on your account' using errcode = '42501';
  end if;
  insert into showcases (site_id, slug, title, category, description, cover_url, sort, active, sample_business, created_by)
  values (p_site, p_slug, p_title, coalesce(p_category, ''), coalesce(p_description, ''), p_cover, coalesce(p_sort, 0), coalesce(p_active, true), coalesce(p_sample, ''), p_actor)
  on conflict (site_id) do update set slug = excluded.slug, title = excluded.title, category = excluded.category,
    description = excluded.description, cover_url = excluded.cover_url, sort = excluded.sort, active = excluded.active,
    sample_business = excluded.sample_business, updated_at = now()
  returning id into v_id;
  return v_id;
end
$$;

create or replace function remove_showcase(p_actor uuid, p_id uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists (select 1 from platform_admins where user_id = p_actor) then
    raise exception 'only platform admins manage premade sites' using errcode = '42501';
  end if;
  delete from showcases where id = p_id;
end
$$;

revoke all on function list_showcases(boolean), showcase_source(uuid), showcase_products(uuid),
  set_showcase(uuid, uuid, text, text, text, text, text, integer, boolean, text), remove_showcase(uuid, uuid) from public;
grant execute on function list_showcases(boolean), showcase_source(uuid), showcase_products(uuid),
  set_showcase(uuid, uuid, text, text, text, text, text, integer, boolean, text), remove_showcase(uuid, uuid) to zsite_app;
