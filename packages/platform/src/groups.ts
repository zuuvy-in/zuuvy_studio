/**
 * Variant groups. A group is what a customer shops for ("Linen shirt"); each
 * product in it is one combination of the group's options — Colour × Size ×
 * Fit — with its own price, stock and pictures. The group has its own photos
 * too, shown after the chosen variant's.
 *
 * A group is filled either way round: define the options and generate every
 * combination as a product, or select products that already exist and group
 * them, then say which combination each one is.
 */
import { type GroupOption, type GroupSummary, PRODUCT_COLUMNS, type Product } from "./catalog";
import { type Tx, UserError, isUuid } from "./db";

export type ProductGroup = {
  id: string;
  name: string;
  description: string;
  category: string | null;
  images: string[];
  options: GroupOption[];
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

const GROUP_COLUMNS = "id, name, description, category, images, options, active, created_at, updated_at";
const MAX_OPTIONS = 4;
const MAX_VALUES = 30;
const MAX_COMBINATIONS = 200;

export type GroupInput = {
  name: string;
  description?: string;
  category?: string | null;
  images?: string[];
  options: GroupOption[];
  active?: boolean;
};

/** "Colour: Red, Blue\nSize: S, M, L" → options. One option per line. */
export function parseOptions(text: string): GroupOption[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(":");
      if (at < 1) throw new UserError(`Write each option as "Name: value, value" — "${line.slice(0, 40)}" is not.`);
      return {
        name: line.slice(0, at).trim(),
        values: line
          .slice(at + 1)
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      };
    });
}

function cleanOptions(options: GroupOption[]): GroupOption[] {
  if (options.length > MAX_OPTIONS) throw new UserError(`A group can have at most ${MAX_OPTIONS} options (like colour, size, fit).`);
  const names = new Set<string>();
  const out = options.map((o) => {
    const name = o.name.trim().slice(0, 30);
    if (!name) throw new UserError("Every option needs a name, like Colour or Size.");
    if (names.has(name.toLowerCase())) throw new UserError(`"${name}" is listed twice.`);
    names.add(name.toLowerCase());
    const values = [...new Map(o.values.map((v) => [v.trim().toLowerCase(), v.trim().slice(0, 40)])).values()].filter(Boolean);
    if (!values.length) throw new UserError(`Give ${name} at least one value.`);
    if (values.length > MAX_VALUES) throw new UserError(`${name} has more than ${MAX_VALUES} values.`);
    return { name, values };
  });
  if (combinations(out).length > MAX_COMBINATIONS) {
    throw new UserError(`Those options make more than ${MAX_COMBINATIONS} combinations. Split the group, or use fewer values.`);
  }
  return out;
}

/** Every combination of the options, in display order. */
export function combinations(options: GroupOption[]): Record<string, string>[] {
  let out: Record<string, string>[] = [{}];
  for (const o of options) out = out.flatMap((c) => o.values.map((v) => ({ ...c, [o.name]: v })));
  return options.length ? out : [];
}

/** "Red / M / Slim", in the group's option order. */
export function variantLabel(options: GroupOption[], values: Record<string, string>): string {
  return options.map((o) => values[o.name]).filter(Boolean).join(" / ");
}

const comboKey = (options: GroupOption[], values: Record<string, string>) => options.map((o) => values[o.name] ?? "").join("\u0000");

function clean(input: GroupInput) {
  const name = input.name.trim();
  if (!name) throw new UserError("Give the group a name.");
  return {
    name: name.slice(0, 200),
    description: (input.description ?? "").trim().slice(0, 4000),
    category: input.category?.trim() || null,
    images: (input.images ?? []).filter((u) => /^https:\/\//.test(u)).slice(0, 12),
    options: cleanOptions(input.options),
    active: input.active ?? true,
  };
}

export async function listGroups(tx: Tx): Promise<(ProductGroup & { variants: number })[]> {
  return tx.query(
    `select ${GROUP_COLUMNS.split(", ").map((c) => `g.${c}`).join(", ")}, count(p.id)::int as variants
       from product_groups g left join products p on p.group_id = g.id
      group by g.id order by g.name`,
  );
}

export async function getGroup(tx: Tx, id: string): Promise<ProductGroup & { variants: Product[] }> {
  if (!isUuid(id)) throw new UserError("That group does not exist.");
  const group = await tx.get<ProductGroup>(`select ${GROUP_COLUMNS} from product_groups where id = $1`, [id], "group");
  const variants = await tx.query<Product>(`select ${PRODUCT_COLUMNS} from products where group_id = $1 order by name`, [id]);
  return { ...group, variants };
}

export async function createGroup(tx: Tx, input: GroupInput): Promise<ProductGroup> {
  const g = clean(input);
  return tx.get<ProductGroup>(
    `insert into product_groups (tenant_id, name, description, category, images, options, active)
     values (app_tenant(), $1, $2, $3, $4, $5, $6) returning ${GROUP_COLUMNS}`,
    [g.name, g.description, g.category, JSON.stringify(g.images), JSON.stringify(g.options), g.active],
  );
}

export async function updateGroup(tx: Tx, id: string, input: GroupInput): Promise<ProductGroup> {
  if (!isUuid(id)) throw new UserError("That group does not exist.");
  const g = clean(input);
  const group = await tx.get<ProductGroup>(
    `update product_groups set name = $2, description = $3, category = $4, images = $5, options = $6, active = $7, updated_at = now()
      where id = $1 returning ${GROUP_COLUMNS}`,
    [id, g.name, g.description, g.category, JSON.stringify(g.images), JSON.stringify(g.options), g.active],
    "group",
  );
  // A value that is no longer offered is dropped from the variants that had it, so no variant claims an option that does not exist.
  const variants = await tx.query<{ id: string; options: Record<string, string> }>("select id, options from products where group_id = $1", [id]);
  for (const v of variants) {
    const kept = Object.fromEntries(g.options.flatMap((o) => (o.values.includes(v.options[o.name] ?? "") ? [[o.name, v.options[o.name]!]] : [])));
    if (JSON.stringify(kept) !== JSON.stringify(v.options)) await tx.query("update products set options = $2 where id = $1", [v.id, JSON.stringify(kept)]);
  }
  return group;
}

export async function deleteGroup(tx: Tx, id: string): Promise<void> {
  if (!isUuid(id)) throw new UserError("That group does not exist.");
  // The products stay, ungrouped (group_id is set null by the foreign key).
  await tx.query("update products set options = '{}' where group_id = $1", [id]);
  await tx.get("delete from product_groups where id = $1 returning id", [id], "group");
}

/**
 * Create a product for every combination the group does not have yet. Each
 * starts with the given price and stock and the group's category; edit them
 * afterwards. Existing variants are left alone.
 */
export async function generateVariants(
  tx: Tx,
  groupId: string,
  base: { price: number; mrp?: number | null; stock?: number | null },
): Promise<{ created: number }> {
  const group = await getGroup(tx, groupId);
  if (!group.options.length) throw new UserError("Add options first (like Colour: Red, Blue).");
  if (!(base.price >= 0) || base.price > 10_000_000) throw new UserError("Give the variants a price.");
  const have = new Set(group.variants.map((v) => comboKey(group.options, v.options)));
  let created = 0;
  for (const combo of combinations(group.options)) {
    if (have.has(comboKey(group.options, combo))) continue;
    const stock = base.stock ?? null;
    await tx.query(
      `insert into products (tenant_id, source, name, description, category, price, mrp, images, in_stock, stock, active, group_id, options)
       values (app_tenant(), 'native', $1, '', $2, $3, $4, '[]', $5, $6, true, $7, $8)`,
      [
        `${group.name} — ${variantLabel(group.options, combo)}`,
        group.category,
        Math.round(base.price * 100) / 100,
        base.mrp ?? null,
        stock === null || stock > 0,
        stock,
        groupId,
        JSON.stringify(combo),
      ],
    );
    created++;
  }
  return { created };
}

/** Put existing products into a group. Their options are set afterwards (setVariants). */
export async function addToGroup(tx: Tx, groupId: string, productIds: string[]): Promise<number> {
  const ids = productIds.filter(isUuid);
  if (!ids.length) throw new UserError("Choose the products to group.");
  await getGroup(tx, groupId);
  const rows = await tx.query("update products set group_id = $1, options = '{}', updated_at = now() where id = any($2::uuid[]) returning id", [groupId, ids]);
  return rows.length;
}

export async function removeFromGroup(tx: Tx, productIds: string[]): Promise<void> {
  const ids = productIds.filter(isUuid);
  await tx.query("update products set group_id = null, options = '{}', updated_at = now() where id = any($1::uuid[])", [ids]);
}

/**
 * Say which combination each variant is, and optionally its price and stock.
 * Every value must be one the group offers, and no two variants may be the
 * same combination — a customer choosing "Red / M" must reach one product.
 */
export async function setVariants(
  tx: Tx,
  groupId: string,
  rows: { productId: string; options: Record<string, string>; price?: number | null; stock?: number | null }[],
): Promise<void> {
  const group = await getGroup(tx, groupId);
  const members = new Map(group.variants.map((v) => [v.id, v]));
  const seen = new Map<string, string>();
  for (const row of rows) {
    const v = members.get(row.productId);
    if (!v) throw new UserError("One of those products is not in this group.");
    const options: Record<string, string> = {};
    for (const o of group.options) {
      const value = row.options[o.name];
      if (!value) continue;
      if (!o.values.includes(value)) throw new UserError(`${o.name} has no value "${value}".`);
      options[o.name] = value;
    }
    const key = comboKey(group.options, options);
    if (Object.keys(options).length === group.options.length) {
      const other = seen.get(key);
      if (other) throw new UserError(`${other} and ${v.name} are both ${variantLabel(group.options, options)}. Each combination can be one product.`);
      seen.set(key, v.name);
    }
    const sets = ["options = $2", "updated_at = now()"];
    const params: unknown[] = [v.id, JSON.stringify(options)];
    if (v.source === "native" && row.price !== undefined && row.price !== null) {
      if (row.price < 0 || row.price > 10_000_000) throw new UserError(`The price of ${v.name} is not a sensible amount.`);
      params.push(Math.round(row.price * 100) / 100);
      sets.push(`price = $${params.length}`);
    }
    if (v.source === "native" && row.stock !== undefined) {
      if (row.stock !== null && (row.stock < 0 || row.stock > 10_000_000)) throw new UserError(`The stock of ${v.name} is not a sensible number.`);
      params.push(row.stock);
      sets.push(`stock = $${params.length}`, `in_stock = coalesce($${params.length}::numeric > 0, true)`);
    }
    await tx.query(`update products set ${sets.join(", ")} where id = $1`, params);
  }
}

/** The groups behind a list of products, for the storefront. */
export async function groupSummaries(tx: Tx, ids: string[]): Promise<Map<string, GroupSummary>> {
  const unique = [...new Set(ids)].filter(isUuid);
  if (!unique.length) return new Map();
  const rows = await tx.query<GroupSummary & { active: boolean }>(
    "select id, name, images, options, active from product_groups where id = any($1::uuid[])",
    [unique],
  );
  return new Map(rows.filter((g) => g.active).map((g) => [g.id, { id: g.id, name: g.name, images: g.images, options: g.options }]));
}
