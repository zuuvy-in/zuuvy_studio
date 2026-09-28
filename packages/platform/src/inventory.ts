/**
 * What kind of site a site is, and — for a store — who manages what it sells.
 *
 *   studio  products and stock are managed here (source 'native'). Stock is
 *           taken when the business accepts an order and put back if an
 *           accepted order is cancelled or rejected.
 *   source  a connected data source (Zuuvy) owns products, prices and stock;
 *           orders go to it, and it says what happens next.
 *   none    products are managed here, stock is not tracked at all.
 *
 * The catalogue itself is the business's (one table per tenant); the
 * setting decides which part of it each store shows and takes orders for.
 */
import type { SiteKind } from "@zsite/core";
import { type Product, PRODUCT_COLUMNS } from "./catalog";
import { type Tx, UserError, isUuid, withTenant } from "./db";
import { getIntegration } from "./integrations";
import type { OrderStatus } from "@zsite/connectors";
import { addOrderEvent } from "./orders";

export type InventoryMode = "studio" | "source" | "none";
export const INVENTORY_MODES: InventoryMode[] = ["studio", "source", "none"];
export const SITE_KINDS: SiteKind[] = ["landing", "portfolio", "store"];

/**
 * What a store does with a product it has run out of:
 *   show  list it as "Out of stock", no ordering (the default)
 *   hide  leave it off the storefront until stock returns
 *   sell  keep taking orders; the business sources the rest
 */
export type OutOfStockMode = "show" | "hide" | "sell";
export const OUT_OF_STOCK_MODES: OutOfStockMode[] = ["show", "hide", "sell"];

export type SiteInventory = { kind: SiteKind; inventory: InventoryMode; inventory_source: string | null; out_of_stock: OutOfStockMode };

export async function siteInventory(tx: Tx, siteId: string): Promise<SiteInventory> {
  return tx.get<SiteInventory>("select kind, inventory, inventory_source, out_of_stock from sites where id = $1", [siteId], "site");
}

/** Which product sources a store sells; null for a site that is not a store. */
export function sourcesFor(s: SiteInventory): string[] | null {
  if (s.kind !== "store") return null;
  return s.inventory === "source" ? [s.inventory_source ?? "zuuvy"] : ["native"];
}

export const tracksStock = (s: SiteInventory) => s.kind !== "store" || s.inventory !== "none";

/** Orders are taken whatever the stock says. Meaningless without stock tracking, where nothing is ever out. */
export const sellsOutOfStock = (s: SiteInventory) => s.kind === "store" && tracksStock(s) && s.out_of_stock === "sell";

export async function setOutOfStock(tx: Tx, siteId: string, mode: string): Promise<void> {
  if (!OUT_OF_STOCK_MODES.includes(mode as OutOfStockMode)) throw new UserError("Choose what the store does with out-of-stock products.");
  await tx.get("update sites set out_of_stock = $2, updated_at = now() where id = $1 returning id", [siteId, mode], "site");
}

export async function setSiteKind(tx: Tx, siteId: string, kind: string): Promise<void> {
  if (!SITE_KINDS.includes(kind as SiteKind)) throw new UserError("Choose a landing page, portfolio or store.");
  await tx.get("update sites set kind = $2, updated_at = now() where id = $1 returning id", [siteId, kind], "site");
}

export async function setInventory(tx: Tx, siteId: string, mode: string, source: string | null): Promise<void> {
  if (!INVENTORY_MODES.includes(mode as InventoryMode)) throw new UserError("Choose who manages this store's inventory.");
  let src: string | null = null;
  if (mode === "source") {
    src = source || "zuuvy";
    const integration = await getIntegration(tx, src);
    if (!integration || integration.status === "disconnected") {
      throw new UserError("Connect a data source first (Integrations), then choose it here.");
    }
  }
  await tx.get(
    "update sites set inventory = $2, inventory_source = $3, updated_at = now() where id = $1 returning id",
    [siteId, mode, src],
    "site",
  );
}

/** Whether any site of this business is a store — the Products and Orders pages follow it. */
export async function hasStore(tx: Tx): Promise<boolean> {
  const row = await tx.one<{ yes: boolean }>("select exists (select 1 from sites where kind = 'store') as yes");
  return Boolean(row?.yes);
}

/** Whether any store manages products here, so the Products page offers adding them. */
export async function managesProducts(tx: Tx): Promise<boolean> {
  const row = await tx.one<{ yes: boolean }>("select exists (select 1 from sites where kind = 'store' and inventory in ('studio', 'none')) as yes");
  return Boolean(row?.yes);
}

// ---------------------------------------------------------------------------
// Products managed in the studio
// ---------------------------------------------------------------------------

export type ProductInput = {
  name: string;
  description?: string;
  category?: string | null;
  price: number | null;
  mrp?: number | null;
  unitLabel?: string | null;
  images?: string[];
  /** null = not counted. */
  stock?: number | null;
  active?: boolean;
};

function clean(input: ProductInput) {
  const name = input.name.trim();
  if (!name) throw new UserError("Give the product a name.");
  if (name.length > 200) throw new UserError("Keep the name under 200 characters.");
  const money = (v: number | null | undefined, what: string) => {
    if (v === null || v === undefined || Number.isNaN(v)) return null;
    if (v < 0 || v > 10_000_000) throw new UserError(`${what} is not a sensible amount.`);
    return Math.round(v * 100) / 100;
  };
  const price = money(input.price, "The price");
  const mrp = money(input.mrp, "The MRP");
  if (mrp !== null && price !== null && mrp < price) throw new UserError("The MRP cannot be below the price.");
  const stock = input.stock === null || input.stock === undefined || Number.isNaN(input.stock) ? null : input.stock;
  if (stock !== null && (stock < 0 || stock > 10_000_000)) throw new UserError("Stock is not a sensible number.");
  const images = (input.images ?? []).filter((u) => /^https:\/\//.test(u)).slice(0, 12);
  return {
    name,
    description: (input.description ?? "").trim().slice(0, 4000),
    category: input.category?.trim() || null,
    price,
    mrp,
    unit_label: input.unitLabel?.trim() || null,
    images,
    stock,
    in_stock: stock === null || stock > 0,
    active: input.active ?? true,
  };
}

export async function createProduct(tx: Tx, input: ProductInput): Promise<Product> {
  const p = clean(input);
  return tx.get<Product>(
    `insert into products (tenant_id, source, name, description, category, price, mrp, unit_label, images, in_stock, stock, active)
     values (app_tenant(), 'native', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning ${PRODUCT_COLUMNS}`,
    [p.name, p.description, p.category, p.price, p.mrp, p.unit_label, JSON.stringify(p.images), p.in_stock, p.stock, p.active],
  );
}

export async function updateProduct(tx: Tx, id: string, input: ProductInput): Promise<Product> {
  if (!isUuid(id)) throw new UserError("That product does not exist.");
  const p = clean(input);
  const row = await tx.one<Product>(
    `update products set name = $2, description = $3, category = $4, price = $5, mrp = $6, unit_label = $7, images = $8,
            in_stock = $9, stock = $10, active = $11, updated_at = now()
      where id = $1 and source = 'native' returning ${PRODUCT_COLUMNS}`,
    [id, p.name, p.description, p.category, p.price, p.mrp, p.unit_label, JSON.stringify(p.images), p.in_stock, p.stock, p.active],
  );
  if (!row) throw new UserError("Only products managed here can be edited here; the others belong to their data source.");
  return row;
}

export async function getProduct(tx: Tx, id: string): Promise<Product> {
  if (!isUuid(id)) throw new UserError("That product does not exist.");
  return tx.get<Product>(`select ${PRODUCT_COLUMNS} from products where id = $1`, [id], "product");
}

// ---------------------------------------------------------------------------
// Orders a store fulfils itself (not sent to a data source)
// ---------------------------------------------------------------------------

/** What the business can do next with an order it fulfils itself. */
export const NEXT_STEPS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "rejected"],
  confirmed: ["packed", "shipped", "delivered", "cancelled"],
  packed: ["shipped", "delivered", "cancelled"],
  shipped: ["delivered", "cancelled"],
  delivered: [],
  rejected: [],
  cancelled: [],
};

type Line = { productId: string; quantity: number; source: string; name: string };

/**
 * Accept, reject, pack, ship, deliver or cancel an order this business
 * fulfils itself. Accepting takes stock (a store on `studio` inventory),
 * refusing if it is not there — or, for a store that sells out-of-stock
 * products, taking what there is; cancelling an accepted order returns
 * exactly what was taken (`orders.stock_taken`).
 */
export async function advanceOrder(tenantId: string, orderId: string, to: OrderStatus, note = ""): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const order = await tx.get<{ status: OrderStatus; sync_state: string; lines: Line[]; site_id: string | null; stock_taken: Record<string, number> | null }>(
      "select status, sync_state, lines, site_id, stock_taken from orders where id = $1 for update",
      [orderId],
      "order",
    );
    if (order.sync_state !== "not_linked") throw new UserError("This order is handled by its data source; its status comes from there.");
    if (!(NEXT_STEPS[order.status] ?? []).includes(to)) throw new UserError(`An order that is ${order.status} cannot become ${to}.`);
    const inv = order.site_id ? await siteInventory(tx, order.site_id).catch(() => null) : null;
    const counts = inv?.kind === "store" && inv.inventory === "studio";

    if (counts && to === "confirmed") {
      const beyond = inv !== null && sellsOutOfStock(inv);
      const taken: Record<string, number> = {};
      for (const l of order.lines.filter((x) => x.source === "native")) {
        if (beyond) {
          // Take what is on the shelf, down to zero; the business sources the rest.
          const row = await tx.one<{ took: number }>(
            `with p as (select id, stock from products where id = $1 and stock is not null for update)
             update products set stock = products.stock - least(p.stock, $2), in_stock = (products.stock - least(p.stock, $2)) > 0,
                                 updated_at = now()
               from p where products.id = p.id returning least(p.stock, $2) as took`,
            [l.productId, l.quantity],
          );
          taken[l.productId] = (taken[l.productId] ?? 0) + Number(row?.took ?? 0);
          continue;
        }
        // Conditional: two acceptances at once cannot both take the last unit.
        const ok = await tx.one(
          `update products set stock = stock - $2, in_stock = (stock - $2) > 0, updated_at = now()
            where id = $1 and (stock is null or stock >= $2) returning id`,
          [l.productId, l.quantity],
        );
        if (!ok) throw new UserError(`Not enough ${l.name} in stock to accept this order.`);
        taken[l.productId] = (taken[l.productId] ?? 0) + l.quantity;
      }
      await tx.query("update orders set stock_taken = $2 where id = $1", [orderId, JSON.stringify(taken)]);
    }
    const wasHolding = order.status === "confirmed" || order.status === "packed" || order.status === "shipped";
    if (counts && wasHolding && to === "cancelled") {
      // Put back what accepting took; orders accepted before that was recorded took their full quantity.
      const back: Record<string, number> = order.stock_taken ?? {};
      if (!order.stock_taken) {
        for (const l of order.lines.filter((x) => x.source === "native")) back[l.productId] = (back[l.productId] ?? 0) + l.quantity;
      }
      for (const [productId, quantity] of Object.entries(back)) {
        if (quantity <= 0) continue;
        await tx.query(
          "update products set stock = stock + $2, in_stock = true, updated_at = now() where id = $1 and stock is not null",
          [productId, quantity],
        );
      }
    }
    await tx.query("update orders set status = $2, updated_at = now() where id = $1", [orderId, to]);
    const labels: Record<string, string> = {
      confirmed: "Accepted by the business",
      rejected: "Declined by the business",
      packed: "Packed",
      shipped: "On the way",
      delivered: "Delivered",
      cancelled: "Cancelled by the business",
    };
    await addOrderEvent(tx, orderId, to, note.trim().slice(0, 300) || labels[to] || to, "studio");
  });
}
