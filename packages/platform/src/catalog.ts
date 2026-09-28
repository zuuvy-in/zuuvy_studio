/**
 * The storefront's catalogue. Products come from an integration (Zuuvy
 * today) and are mirrored here, so a store keeps selling from its last good
 * copy while Zuuvy is unreachable. One side owns each fact: for a Zuuvy
 * product, Zuuvy owns name, price and stock and this side never edits them.
 */
import type { CatalogItem } from "@zsite/connectors";
import { type Tx, UserError, withTenant } from "./db";
import { loadConnection, logEvent } from "./integrations";

export type Product = {
  id: string;
  source: "native" | "zuuvy";
  external_id: string | null;
  name: string;
  description: string;
  category: string | null;
  price: number | null;
  mrp: number | null;
  currency: string;
  unit_label: string | null;
  images: string[];
  in_stock: boolean;
  stock: number | null;
  active: boolean;
  synced_at: Date | null;
  updated_at: Date;
  /** The variant group this product is one combination of, if any. */
  group_id: string | null;
  /** This product's value for each of its group's options: { Colour: "Red", Size: "M" }. */
  options: Record<string, string>;
  /** Set by the storefront: this store takes orders beyond its stock (sites.out_of_stock = 'sell'). */
  backorders?: boolean;
  /** Set by the storefront: the group, for showing variants as one card. */
  group?: GroupSummary;
};

export type GroupSummary = { id: string; name: string; images: string[]; options: GroupOption[] };
export type GroupOption = { name: string; values: string[] };

export const PRODUCT_COLUMNS = `id, source, external_id, name, description, category, price, mrp, currency, unit_label,
  images, in_stock, stock, active, synced_at, updated_at, group_id, options`;

export async function upsertProduct(tx: Tx, source: "zuuvy", item: CatalogItem): Promise<void> {
  await tx.query(
    `insert into products (tenant_id, source, external_id, name, description, category, price, mrp, unit_label,
                           images, in_stock, stock, active, synced_at, updated_at)
     values (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
     on conflict (tenant_id, source, external_id) do update set
       name = excluded.name, description = excluded.description, category = excluded.category,
       price = excluded.price, mrp = excluded.mrp, unit_label = excluded.unit_label, images = excluded.images,
       in_stock = excluded.in_stock, stock = excluded.stock, active = excluded.active,
       synced_at = now(), updated_at = now()`,
    [source, item.externalId, item.name, item.description, item.category, item.price, item.mrp, item.unitLabel,
      JSON.stringify(item.images), item.inStock, item.stock, item.listed && item.price !== null],
  );
}

export async function hideProduct(tx: Tx, source: "zuuvy", externalId: string): Promise<void> {
  await tx.query(
    "update products set active = false, synced_at = now(), updated_at = now() where source = $1 and external_id = $2",
    [source, externalId],
  );
}

export type ProductQuery = {
  category?: string | null;
  limit?: number;
  sort?: "name" | "price_asc" | "price_desc" | "newest";
  q?: string;
  /** Only products from these sources — a store shows the catalogue its inventory setting names. */
  sources?: string[];
};

/** What a storefront may show: active products with a price. */
export async function storefrontProducts(tx: Tx, query: ProductQuery = {}): Promise<Product[]> {
  const order = {
    name: "name asc",
    price_asc: "price asc nulls last, name",
    price_desc: "price desc nulls last, name",
    newest: "updated_at desc",
  }[query.sort ?? "name"];
  const params: unknown[] = [];
  let where = "active and price is not null";
  if (query.category) {
    params.push(query.category);
    where += ` and lower(category) = lower($${params.length})`;
  }
  if (query.sources) {
    params.push(query.sources);
    where += ` and source = any($${params.length}::text[])`;
  }
  params.push(Math.min(query.limit ?? 48, 200));
  return tx.query<Product>(`select ${PRODUCT_COLUMNS} from products where ${where} order by ${order} limit $${params.length}`, params);
}

export async function listProducts(tx: Tx, opts: { includeHidden?: boolean; q?: string } = {}): Promise<Product[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (!opts.includeHidden) where.push("active");
  if (opts.q) {
    params.push(`%${opts.q}%`);
    where.push(`(name ilike $${params.length} or category ilike $${params.length})`);
  }
  return tx.query<Product>(
    `select ${PRODUCT_COLUMNS} from products ${where.length ? `where ${where.join(" and ")}` : ""}
     order by active desc, name limit 500`,
    params,
  );
}

export async function getProducts(tx: Tx, ids: string[]): Promise<Product[]> {
  if (!ids.length) return [];
  return tx.query<Product>(`select ${PRODUCT_COLUMNS} from products where id = any($1::uuid[])`, [ids]);
}

export async function productCategories(tx: Tx): Promise<{ category: string; count: number }[]> {
  return tx.query(
    `select category, count(*)::int as count from products
      where active and category is not null group by category order by count desc, category`,
  );
}

const MAX_ITEMS = 10_000;

export type SyncResult = { updated: number; hidden: number; full: boolean };

/**
 * Pull the catalogue. A full sync lists everything on sale and hides what is
 * missing from it; an incremental one asks for changes since the last sync,
 * which includes products taken down (`listed: false`).
 *
 * The high-water mark is the moment the pull *started*, so a product edited
 * during a long sync is fetched again next time rather than missed.
 */
export async function syncCatalog(tenantId: string, opts: { kind?: string; full?: boolean } = {}): Promise<SyncResult> {
  const kind = opts.kind ?? "zuuvy";
  const loaded = await withTenant(tenantId, (tx) => loadConnection(tx, kind));
  if (!loaded) throw new UserError("Not connected.");
  const { connector, conn, integration } = loaded;
  if (!connector.fetchCatalog) throw new UserError(`${connector.name} has no catalogue.`);

  const full = opts.full || !integration.last_sync_at;
  const startedAt = new Date();
  const items: CatalogItem[] = [];
  try {
    let cursor: string | null = null;
    do {
      const page = await connector.fetchCatalog(conn, { since: full ? null : integration.last_sync_at, cursor });
      items.push(...page.items);
      cursor = page.nextCursor;
      if (items.length > MAX_ITEMS) throw new Error(`catalogue larger than ${MAX_ITEMS} products`);
    } while (cursor);
  } catch (e) {
    await withTenant(tenantId, async (tx) => {
      await tx.query("update integrations set last_error = $1, updated_at = now() where id = $2", [
        `Catalogue sync failed: ${(e as Error).message}`,
        integration.id,
      ]);
      await logEvent(tx, integration.id, { direction: "out", topic: "catalog.sync", status: "error", summary: (e as Error).message });
    });
    throw e;
  }

  return withTenant(tenantId, async (tx) => {
    let hidden = 0;
    for (const item of items) {
      await upsertProduct(tx, "zuuvy", item);
      if (!item.listed) hidden++;
    }
    if (full) {
      const seen = items.filter((i) => i.listed).map((i) => i.externalId);
      const gone = await tx.query(
        `update products set active = false, updated_at = now()
          where source = 'zuuvy' and active and not (external_id = any($1::text[])) returning id`,
        [seen],
      );
      hidden += gone.length;
    }
    await tx.query(
      `update integrations set last_sync_at = $1,
         last_error = case when last_error like 'Catalogue sync failed%' then null else last_error end,
         updated_at = now() where id = $2`,
      [startedAt, integration.id],
    );
    const updated = items.filter((i) => i.listed).length;
    await logEvent(tx, integration.id, {
      direction: "out",
      topic: "catalog.sync",
      status: "ok",
      summary: `${full ? "Full" : "Incremental"} sync: ${updated} product${updated === 1 ? "" : "s"} updated${hidden ? `, ${hidden} hidden` : ""}`,
    });
    return { updated, hidden, full };
  });
}
