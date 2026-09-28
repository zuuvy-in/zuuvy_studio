/** Local only: fill the demo store with variants, photos, a discount and publish it with a cart drawer. */
import { applyOps } from "@zsite/core";
import {
  closePool, createDiscount, createGroup, createProduct, createVersion, generateVariants, getGroup, latestVersion,
  loadRootEnv, parseOptions, publishVersion, setInventory, setVariants, withGlobal, withTenant,
} from "@zsite/platform";

loadRootEnv();
const who = await withGlobal((tx) =>
  tx.get<{ tenant_id: string; user_id: string }>(
    "select m.tenant_id, m.user_id from users u join memberships m on m.user_id = u.id where u.email = 'demo@zuuvy.site'",
  ),
);
await withTenant(who.tenant_id, async (tx) => {
  const site = await tx.get<{ id: string }>("select id from sites where subdomain = 'demo'");
  await setInventory(tx, site.id, "studio", null);
  if (!(await tx.one("select 1 from product_groups where name = 'Linen shirt'"))) {
    const img = (seed: string) => `https://picsum.photos/seed/${seed}/800/800`;
    const g = await createGroup(tx, {
      name: "Linen shirt", category: "Shirts", description: "Breathable pure linen, cut for Patna summers.",
      images: [img("linen-life"), img("linen-fabric")], options: parseOptions("Colour: White, Olive\nSize: M, L\nFit: Slim, Regular"),
    });
    await generateVariants(tx, g.id, { price: 1499, mrp: 1999, stock: 4 });
    const full = await getGroup(tx, g.id);
    for (const v of full.variants) {
      await tx.query("update products set images = $2 where id = $1", [v.id, JSON.stringify([img(`linen-${v.options.Colour}`)])]);
    }
    await setVariants(tx, g.id, full.variants.filter((v) => v.options.Size === "L").map((v) => ({ productId: v.id, options: v.options, price: 1599 })));
    await createProduct(tx, { name: "Canvas tote", category: "Bags", price: 699, stock: 10, images: [img("tote-1"), img("tote-2"), img("tote-3")] });
    await createProduct(tx, { name: "Leather belt", category: "Accessories", price: 999, stock: 0 });
    await createDiscount(tx, { name: "Summer 10% off", code: "SUMMER10", kind: "percent", value: 10 });
    await createDiscount(tx, { name: "₹200 off over ₹3,000", kind: "fixed", value: 200, minSubtotal: 3000 });
  }
  const base = await latestVersion(tx, site.id);
  const tree = applyOps(base.tree!, [{ op: "setCommerce", commerce: { cart: { style: "drawer", icon: "bag", label: "Bag" }, buy: "both", checkout: { layout: "steps", reassurance: "Free delivery across Patna · Easy 7-day returns" } } }]);
  const v = await createVersion(tx, site.id, { tree, parentId: base.id, source: "manual", summary: "Shop demo", userId: who.user_id });
  await publishVersion(tx, site.id, v.id, who.user_id);
  console.log("published demo store version", v.number);
});
await closePool();
