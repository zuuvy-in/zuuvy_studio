/**
 * Puts the premade designs (core/showcase.ts) on the platform's own account as
 * real, published sites and offers each as a showcase. Idempotent: run again
 * and each site gets a new version with the current design, never a duplicate.
 *
 * Pictures come from the photo library by what each slot should show. With no
 * library key they are left out and the blocks draw placeholders — a showcase
 * is never seeded with a guessed image address.
 */
import { type PhotoLookup, SHOWCASE, type ShowcaseDesign, parseBrand } from "@zsite/core";
import { UserError, withGlobal, withTenant } from "./db";
import { createSiteFrom, createVersion, publishVersion } from "./sites";
import { setShowcase } from "./showcases";
import { applyTableOps } from "./tables";

export type PhotoSearch = (query: string) => Promise<string | undefined>;

/** The Unsplash API, as the design kit uses it: one landscape photo per query, credited on the site's footer. */
export function unsplashSearch(key: string, fetcher: typeof fetch = fetch): PhotoSearch {
  return async (query) => {
    const url = new URL("https://api.unsplash.com/search/photos");
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", "1");
    url.searchParams.set("orientation", "landscape");
    url.searchParams.set("content_filter", "high");
    const res = await fetcher(url, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" } });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { results?: { urls?: { raw?: string }; links?: { download_location?: string } }[] };
    const hit = body.results?.[0];
    if (!hit?.urls?.raw) return undefined;
    // Unsplash asks that using a photo is reported through its download link.
    if (hit.links?.download_location) void fetcher(hit.links.download_location, { headers: { Authorization: `Client-ID ${key}` } }).catch(() => {});
    return `${hit.urls.raw}&w=1600&q=80&auto=format&fit=crop`;
  };
}

async function photosFor(design: ShowcaseDesign, search: PhotoSearch | null): Promise<PhotoLookup> {
  const found = new Map<string, string>();
  if (search) {
    for (const [slot, query] of Object.entries(design.photos)) {
      const url = await search(query).catch(() => undefined);
      if (url) found.set(slot, url);
    }
  }
  return (slot) => found.get(slot);
}

export type SeedReport = { slug: string; siteId: string; version: number; photos: number; created: boolean }[];

export async function seedShowcases(
  adminEmail: string,
  opts: { search?: PhotoSearch | null; only?: string[]; log?: (line: string) => void } = {},
): Promise<SeedReport> {
  const who = await withGlobal((tx) =>
    tx.one<{ user_id: string; tenant_id: string }>(
      `select m.user_id, m.tenant_id from users u join memberships m on m.user_id = u.id
        where u.email = $1 order by (m.role = 'owner') desc, m.created_at limit 1`,
      [adminEmail.toLowerCase()],
    ),
  );
  if (!who) throw new UserError(`No account for ${adminEmail}: create it first (npm run admin:create).`);
  const report: SeedReport = [];
  const designs = SHOWCASE.filter((d) => !opts.only?.length || opts.only.includes(d.slug));
  for (const [i, design] of designs.entries()) {
    const photo = await photosFor(design, opts.search ?? null);
    const tree = design.build(photo);
    const subdomain = `tpl-${design.slug}`;
    const done = await withTenant(who.tenant_id, async (tx) => {
      const existing = await tx.one<{ id: string; published_version_id: string | null }>("select id, published_version_id from sites where subdomain = $1", [subdomain]);
      let siteId: string;
      let version: number;
      if (existing) {
        const v = await createVersion(tx, existing.id, { tree, data: {}, parentId: existing.published_version_id, source: "manual", summary: "Premade design updated", userId: who.user_id });
        await publishVersion(tx, existing.id, v.id, who.user_id);
        siteId = existing.id;
        version = v.number;
      } else {
        const site = await createSiteFrom(tx, {
          name: design.name,
          subdomain,
          kind: design.kind,
          tree,
          data: {},
          brand: parseBrand({}),
          summary: `Premade design: ${design.name}`,
          userId: who.user_id,
        });
        siteId = site.id;
        version = 1;
      }
      if (design.tables?.length) {
        await applyTableOps(tx, siteId, design.tables.map((t) => ({ op: "create" as const, key: t.key, name: t.name, columns: t.columns, notify: false })));
      }
      if (design.products?.length) {
        await tx.query("delete from products where site_id = $1 and source = 'native'", [siteId]);
        for (const p of design.products) {
          const image = photo(p.photo);
          await tx.query(
            `insert into products (tenant_id, source, name, description, category, price, mrp, images, in_stock, stock, active, site_id)
             values (app_tenant(), 'native', $1, $2, $3, $4, $5, $6, true, null, true, $7)`,
            [p.name, p.description, p.category, p.price, p.mrp ?? null, JSON.stringify(image ? [image] : []), siteId],
          );
        }
        await tx.query("update sites set inventory = 'none' where id = $1", [siteId]);
      }
      return { siteId, version, created: !existing };
    });
    await setShowcase(who.user_id, {
      siteId: done.siteId,
      slug: design.slug,
      title: design.name,
      category: design.category,
      description: design.description,
      coverUrl: photo(design.cover) ?? null,
      sort: i,
      active: true,
      sampleBusiness: design.sampleBusiness,
    });
    const photos = Object.keys(design.photos).filter((s) => photo(s)).length;
    opts.log?.(`${design.slug}: ${done.created ? "created" : "updated"} v${done.version}, ${photos}/${Object.keys(design.photos).length} photos`);
    report.push({ slug: design.slug, siteId: done.siteId, version: done.version, photos, created: done.created });
  }
  return report;
}
