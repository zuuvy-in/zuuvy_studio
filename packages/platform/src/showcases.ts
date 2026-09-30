/**
 * Premade sites. A showcase is a real, published site on the platform's own
 * account; any business can fork it into a site of its own. The fork copies
 * the published version (layout, words, pictures, theme), the brand kit, the
 * form tables' shapes and — for a store, if asked — the sample products.
 * Nothing else of the hosting account is reachable: the doors in the
 * migration hand out exactly those things and only for active showcases.
 */
import { type SiteData, type SiteKind, type SiteTree, parseBrand, parseTree } from "@zsite/core";
import { siteUrl } from "./config";
import { type Tx, UserError, withGlobal, withTenant } from "./db";
import { type Site, createSiteFrom } from "./sites";
import { type TableColumn, applyTableOps } from "./tables";

export type Showcase = {
  id: string;
  slug: string;
  title: string;
  category: string;
  description: string;
  cover_url: string | null;
  sort: number;
  active: boolean;
  sample_business: string;
  site_id: string;
  kind: SiteKind;
  subdomain: string;
  published: boolean;
  url: string;
};

/** Active, published showcases for the gallery; `all` includes hidden ones, for the admin page. */
export async function listShowcases(opts: { all?: boolean } = {}): Promise<Showcase[]> {
  const rows = await withGlobal((tx) => tx.query<Omit<Showcase, "url">>("select * from list_showcases($1)", [Boolean(opts.all)]));
  return rows.map((r) => ({ ...r, url: siteUrl(r.subdomain) }));
}

export type ShowcaseInput = {
  siteId: string;
  slug: string;
  title: string;
  category?: string;
  description?: string;
  coverUrl?: string | null;
  sort?: number;
  active?: boolean;
  sampleBusiness?: string;
};

const refused = (e: unknown): never => {
  if ((e as { code?: string }).code === "42501") throw new UserError((e as Error).message.replace(/^.*?: /, ""));
  if ((e as { code?: string }).code === "23505") throw new UserError("Another premade site already uses that short name.");
  if ((e as { code?: string }).code === "23514") throw new UserError("A short name is lowercase letters, digits and hyphens.");
  throw e;
};

/** Offer one of the admin's own sites as a premade site (or change how it is offered). Platform admins only — checked in the database. */
export async function setShowcase(actorId: string, input: ShowcaseInput): Promise<string> {
  const title = input.title.trim().slice(0, 80);
  if (!title) throw new UserError("Give it a title.");
  if (input.coverUrl && !/^https:\/\//.test(input.coverUrl)) throw new UserError("The cover must be an https address.");
  const row = await withGlobal((tx) =>
    tx.get<{ id: string }>("select set_showcase($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as id", [
      actorId,
      input.siteId,
      input.slug.trim().toLowerCase(),
      title,
      (input.category ?? "").trim().slice(0, 60),
      (input.description ?? "").trim().slice(0, 300),
      input.coverUrl || null,
      input.sort ?? 0,
      input.active ?? true,
      (input.sampleBusiness ?? "").trim().slice(0, 80),
    ]),
  ).catch(refused);
  return row.id;
}

export async function removeShowcase(actorId: string, id: string): Promise<void> {
  await withGlobal((tx) => tx.query("select remove_showcase($1, $2)", [actorId, id])).catch(refused);
}

/** Every string in a tree with the sample business's name swapped for the new owner's. */
export function renameIn<T>(value: T, from: string, to: string): T {
  if (!from || from === to) return value;
  const pattern = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return /^https?:\/\//.test(v) ? v : v.replace(pattern, to);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** The tree with the new name throughout — or, if a long name would overflow a field, just in the header and title. */
function renamedTree(tree: SiteTree, from: string, to: string): SiteTree {
  try {
    return parseTree(renameIn(tree, from, to));
  } catch {
    const safe = parseTree(tree);
    safe.nav.brand = to.slice(0, 60);
    safe.meta.title = to.slice(0, 100);
    return safe;
  }
}

type Source = { kind: SiteKind; name: string; sample_business: string; tree: SiteTree; data: SiteData | null; brand: unknown; tables: { key: string; name: string; columns: TableColumn[]; notify: boolean }[] };

async function source(tx: Tx, id: string): Promise<Source> {
  const row = await tx.one<Source>("select * from showcase_source($1)", [id]);
  if (!row) throw new UserError("That premade site is no longer available.");
  return row;
}

/**
 * Start a site from a premade one, in the forking business's own account.
 * The sample business name becomes theirs throughout; pictures, layout and
 * theme are kept as they are — the builder is where they make it their own.
 */
export async function forkShowcase(
  tenantId: string,
  input: { showcaseId: string; name: string; subdomain: string; businessName: string; userId: string; withProducts?: boolean },
): Promise<Site> {
  return withTenant(tenantId, async (tx) => {
    const src = await source(tx, input.showcaseId);
    const tree = renamedTree(src.tree, src.sample_business, input.businessName);
    const site = await createSiteFrom(tx, {
      name: input.name,
      subdomain: input.subdomain,
      kind: src.kind,
      tree,
      data: renameIn(src.data ?? {}, src.sample_business, input.businessName),
      brand: parseBrand(src.brand ?? {}),
      summary: `Started from the premade site “${src.name}”`,
      userId: input.userId,
    });
    // The forms work from the first visit: their tables come too (empty).
    if (src.tables.length) {
      await applyTableOps(
        tx,
        site.id,
        src.tables.map((t) => ({ op: "create" as const, key: t.key, name: t.name, columns: t.columns, notify: t.notify })),
      );
    }
    if (input.withProducts && src.kind === "store") {
      const products = await tx.query<{ name: string; description: string; category: string | null; price: string | null; mrp: string | null; images: string[]; unit_label: string | null }>(
        "select * from showcase_products($1)",
        [input.showcaseId],
      );
      for (const p of products) {
        await tx.query(
          `insert into products (tenant_id, source, name, description, category, price, mrp, unit_label, images, in_stock, stock, active, site_id)
           values (app_tenant(), 'native', $1, $2, $3, $4, $5, $6, $7, true, null, true, $8)`,
          [p.name, p.description, p.category, p.price, p.mrp, p.unit_label, JSON.stringify(p.images), site.id],
        );
      }
      // A store that brought sample products manages them here.
      await tx.query("update sites set inventory = 'studio' where id = $1", [site.id]);
    }
    return site;
  });
}
