/**
 * What the renderer needs: which site a Host names, and that site's
 * published tree and data. Resolution goes through SECURITY DEFINER lookups
 * that return ids only; everything after runs inside the tenant's context.
 */
import { type SiteTree, parseHost } from "@zsite/core";
import { type Product, storefrontProducts } from "./catalog";
import { config } from "./config";
import { type Tx, isUuid, withGlobal, withTenant } from "./db";
import { type PublicOrder, publicOrder } from "./orders";

export type ResolvedSite = { tenantId: string; siteId: string };

export async function resolveHost(host: string): Promise<ResolvedSite | null> {
  const parsed = parseHost(host, config.platformDomain());
  if (!parsed) return null;
  const row = await withGlobal((tx) =>
    "subdomain" in parsed
      ? tx.one<{ tenant_id: string; site_id: string }>("select * from resolve_site_by_subdomain($1)", [parsed.subdomain])
      : tx.one<{ tenant_id: string; site_id: string }>("select * from resolve_site_by_domain($1)", [parsed.domain]),
  );
  return row ? { tenantId: row.tenant_id, siteId: row.site_id } : null;
}

export type StorefrontSite = {
  site: { id: string; name: string; subdomain: string; runtime_version: string };
  tenant: { name: string };
  version: { id: string; number: number };
  tree: SiteTree;
};

export async function loadPublished(r: ResolvedSite): Promise<StorefrontSite | null> {
  return withTenant(r.tenantId, async (tx) => {
    const row = await tx.one<{
      id: string;
      name: string;
      subdomain: string;
      runtime_version: string;
      version_id: string | null;
      number: number | null;
      tree: SiteTree | null;
      tenant_name: string;
    }>(
      `select s.id, s.name, s.subdomain, s.runtime_version, v.id as version_id, v.number, v.tree, t.name as tenant_name
         from sites s
         join tenants t on t.id = s.tenant_id
         left join site_versions v on v.id = s.published_version_id
        where s.id = $1`,
      [r.siteId],
    );
    if (!row || !row.version_id || !row.tree) return null;
    return {
      site: { id: row.id, name: row.name, subdomain: row.subdomain, runtime_version: row.runtime_version },
      tenant: { name: row.tenant_name },
      version: { id: row.version_id, number: row.number! },
      tree: row.tree,
    };
  });
}

/** Every product a tree's product grids ask for, in one read. */
export async function productsForTree(tx: Tx, tree: SiteTree): Promise<Product[]> {
  const grids = tree.pages.flatMap((p) => p.sections).filter((s) => s.type === "productGrid");
  if (!grids.length) return [];
  return storefrontProducts(tx, { limit: 200 });
}

export async function storefrontData(r: ResolvedSite, tree: SiteTree): Promise<Product[]> {
  return withTenant(r.tenantId, (tx) => productsForTree(tx, tree));
}

export async function storefrontProduct(r: ResolvedSite, productId: string): Promise<Product | null> {
  if (!isUuid(productId)) return null;
  return withTenant(r.tenantId, async (tx) => {
    const rows = await tx.query<Product>(
      `select id, source, external_id, name, description, category, price, mrp, currency, unit_label, images,
              in_stock, stock, active, synced_at, updated_at
         from products where id = $1 and active and price is not null`,
      [productId],
    );
    return rows[0] ?? null;
  });
}

export async function orderByToken(
  token: string,
): Promise<{ order: PublicOrder; siteId: string | null; tenantId: string } | null> {
  if (!/^[A-Za-z0-9_-]{10,60}$/.test(token)) return null;
  const hit = await withGlobal((tx) =>
    tx.one<{ tenant_id: string; order_id: string }>("select * from resolve_order_token($1)", [token]),
  );
  if (!hit) return null;
  return withTenant(hit.tenant_id, async (tx) => {
    const site = await tx.one<{ site_id: string | null }>("select site_id from orders where id = $1", [hit.order_id]);
    return { order: await publicOrder(tx, hit.order_id), siteId: site?.site_id ?? null, tenantId: hit.tenant_id };
  });
}
