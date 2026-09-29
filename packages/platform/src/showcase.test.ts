/**
 * Premade sites against a real database: seeded on the platform admin's own
 * account, listed to everyone, forked into another business with its forms'
 * tables and sample products — and nothing else of the host reachable.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSite,
  forkShowcase,
  latestVersion,
  listProducts,
  listShowcases,
  listSiteTables,
  renameIn,
  seedShowcases,
  setShowcase,
  signup,
  unsplashSearch,
  withTenant,
} from "./index";
import { createTestDatabase } from "./testing";

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let admin: { userId: string; tenantId: string };
let shop: { userId: string; tenantId: string };

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await signup({ businessName: "Zuuvy", name: "Rishav", email: "rishav@zuuvy.test", password: "password-r", emailVerified: true });
  shop = await signup({ businessName: "Asha Sweets", name: "Asha", email: "asha@sweets.test", password: "password-a", emailVerified: true });
  const owner = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await owner.connect();
  await owner.query("insert into platform_admins (user_id, role) values ($1, 'superadmin')", [admin.userId]);
  await owner.end();
});
afterAll(async () => {
  await db?.drop();
});

describe("premade sites", () => {
  it("seed onto the admin's account, published and offered — and seed again without duplicating", async () => {
    const photos: string[] = [];
    const search = async (q: string) => {
      photos.push(q);
      return q.includes("croissants close up") ? "https://images.unsplash.com/photo-test?ixid=x&w=1600&q=80&auto=format&fit=crop" : undefined;
    };
    const first = await seedShowcases("rishav@zuuvy.test", { search, only: ["bakery", "fashion"] });
    expect(first.map((r) => [r.slug, r.created])).toEqual([["bakery", true], ["fashion", true]]);
    expect(photos.length).toBeGreaterThan(10);
    const again = await seedShowcases("rishav@zuuvy.test", { only: ["bakery"] });
    expect(again[0]).toMatchObject({ slug: "bakery", created: false, version: 2 });

    const list = await listShowcases();
    expect(list.map((s) => s.slug)).toEqual(["bakery", "fashion"]);
    expect(list[0]).toMatchObject({ title: "Warm Bakery", category: "Bakery & café", kind: "landing", published: true, sample_business: "Crumb & Co." });
    expect(list[0]!.url).toContain("tpl-bakery");
  });

  it("fork into another business: its own copy, its name, the forms' tables, and the sample products if asked", async () => {
    const [bakery, fashion] = await listShowcases();
    const site = await forkShowcase(shop.tenantId, { showcaseId: bakery!.id, name: "Default", subdomain: "asha-sweets", businessName: "Asha Sweets", userId: shop.userId });
    expect(site).toMatchObject({ kind: "landing", published_number: 1 });
    const tree = (await withTenant(shop.tenantId, (tx) => latestVersion(tx, site.id))).tree!;
    expect(tree.nav.brand).toBe("Asha Sweets");
    expect(JSON.stringify(tree)).not.toContain("Crumb & Co.");
    expect((await withTenant(shop.tenantId, (tx) => listSiteTables(tx, site.id))).map((t) => [t.key, t.rows])).toEqual([["cake_orders", 0]]);

    const store = await forkShowcase(shop.tenantId, {
      showcaseId: fashion!.id,
      name: "Sweets shop",
      subdomain: "asha-shop",
      businessName: "Asha Sweets",
      userId: shop.userId,
      withProducts: true,
    });
    const products = await withTenant(shop.tenantId, (tx) => listProducts(tx, { siteId: store.id }));
    expect(products.map((p) => p.name)).toContain("Indigo linen kurta");
    expect(products.every((p) => p.source === "native")).toBe(true);
    // The host's own copies are untouched and unseen.
    expect(await withTenant(shop.tenantId, (tx) => tx.query("select id from sites where subdomain like 'tpl-%'"))).toEqual([]);
  });

  it("only a platform admin offers a site, and only one on their own account", async () => {
    const mine = await withTenant(shop.tenantId, (tx) =>
      createSite(tx, { name: "Mine", subdomain: "asha-mine", templateId: "landing-launch", templateInput: { businessName: "Asha" }, userId: shop.userId }),
    );
    await expect(setShowcase(shop.userId, { siteId: mine.id, slug: "mine", title: "Mine" })).rejects.toThrow(/platform admins/);
    await expect(setShowcase(admin.userId, { siteId: mine.id, slug: "mine", title: "Mine" })).rejects.toThrow(/not on your account/);
  });

  it("swaps the sample name everywhere but in addresses", () => {
    expect(renameIn({ a: "Welcome to Crumb & Co.", b: ["crumb & co. bakes"], c: "https://x.test/Crumb & Co." }, "Crumb & Co.", "Asha")).toEqual({
      a: "Welcome to Asha",
      b: ["Asha bakes"],
      c: "https://x.test/Crumb & Co.",
    });
  });

  it("asks Unsplash for one landscape photo and reports its use", async () => {
    const calls: string[] = [];
    const fake = (async (url: URL | string) => {
      calls.push(String(url));
      if (String(url).includes("/search/photos")) {
        return new Response(JSON.stringify({ results: [{ urls: { raw: "https://images.unsplash.com/photo-1?ixid=a" }, links: { download_location: "https://api.unsplash.com/photos/1/download" } }] }));
      }
      return new Response("{}");
    }) as unknown as typeof fetch;
    expect(await unsplashSearch("k", fake)("bakery")).toBe("https://images.unsplash.com/photo-1?ixid=a&w=1600&q=80&auto=format&fit=crop");
    expect(calls[0]).toMatch(/orientation=landscape/);
    expect(calls[1]).toBe("https://api.unsplash.com/photos/1/download");
  });
});
