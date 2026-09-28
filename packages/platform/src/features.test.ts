/**
 * The September features against a real database: usage, the brand kit,
 * versioned data with proposals and table-by-table restore, export → delete
 * → import, revision source round trips, inventory modes, custom domains,
 * GitHub sync, email and platform admins.
 */
import { type EditResult } from "@zsite/ai";
import { applyDataOps, applyOps, parseBrand } from "@zsite/core";
import { strToU8, unzipSync, zipSync } from "fflate";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  HANDLERS,
  addDomain,
  addPlatformAdmin,
  advanceOrder,
  applyProposals,
  checkDomainNow,
  connectGit,
  createProduct,
  createSite,
  deleteSite,
  deletionCheck,
  drainOutbox,
  editData,
  exportRevision,
  exportSite,
  generateVersion,
  getAlerts,
  getOrder,
  getSite,
  importRevision,
  importSite,
  isPlatformAdmin,
  latestVersion,
  listDomains,
  listPlatformAdmins,
  memoryStorage,
  parsePlan,
  placeOrder,
  planVersion,
  removePlatformAdmin,
  restoreVersion,
  saveBrand,
  sentForTests,
  setAlerts,
  setDnsChecker,
  setDomainProvider,
  setGitHubFetch,
  setInventory,
  setOutOfStock,
  setSiteKind,
  setStorage,
  signup,
  storefrontData,
  storefrontProduct,
  uploadAsset,
  usageSummary,
  withGlobal,
  withTenant,
} from "./index";
import { createTestDatabase } from "./testing";

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let a: { userId: string; tenantId: string };
const store = memoryStorage();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

beforeAll(async () => {
  db = await createTestDatabase();
  setStorage(store);
  a = await signup({ businessName: "Priya Studio", name: "Priya", email: "priya@studio.test", password: "password-p" });
});
afterAll(async () => {
  setStorage(undefined);
  setDomainProvider(undefined);
  setDnsChecker(undefined);
  setGitHubFetch(undefined);
  await db?.drop();
});

const portfolio = (subdomain: string, brand?: Parameters<typeof createSite>[1]["brand"]) =>
  withTenant(a.tenantId, (tx) =>
    createSite(tx, {
      name: `Priya ${subdomain}`,
      subdomain,
      templateId: "portfolio-studio",
      templateInput: { businessName: "Priya Studio", email: "priya@studio.test" },
      userId: a.userId,
      brand,
    }),
  );

/** A stand-in for the agent: applies what it is given, reports tokens. */
function fakeEditor(fn: (o: Parameters<NonNullable<Parameters<typeof generateVersion>[2]> extends infer X ? (X extends { editor?: infer E } ? NonNullable<E> : never) : never>[0]) => Partial<EditResult>) {
  return (async (opts: Parameters<typeof fn>[0]) => {
    const r = fn(opts);
    return {
      tree: opts.tree,
      operations: [{ op: "setMeta", title: "x" }],
      summary: "done",
      model: "fake",
      provider: "bedrock",
      usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, requests: 3 },
      images: 0,
      data: opts.data ?? {},
      dataOperations: [],
      proposals: [],
      stopReason: "end_turn",
      ...r,
    } as EditResult;
  }) as never;
}

describe("AI usage", () => {
  it("records every attempt, including one that fails, per person and per business", async () => {
    const site = await portfolio("usage");
    const base = await withTenant(a.tenantId, (tx) => latestVersion(tx, site.id));
    await generateVersion(a.tenantId, { siteId: site.id, baseVersionId: base.id, prompt: "Retitle it", userId: a.userId }, { editor: fakeEditor(() => ({})) });
    const failing = (async () => {
      const { AgentError } = await import("@zsite/ai");
      throw Object.assign(new AgentError("The AI made no changes."), { usage: { input_tokens: 500, output_tokens: 20, cache_read_input_tokens: 0, requests: 1 }, outcome: "no_change" });
    }) as never;
    await expect(generateVersion(a.tenantId, { siteId: site.id, baseVersionId: base.id, prompt: "Do nothing", userId: a.userId }, { editor: failing })).rejects.toThrow(/no changes/);
    const s = await withTenant(a.tenantId, (tx) => usageSummary(tx, a.userId));
    expect(s.mine).toMatchObject({ attempts: 2, versions: 1, input_tokens: 1700, output_tokens: 320 });
    expect(s.business.attempts).toBe(2);
  });
});

describe("plan first", () => {
  it("plans without making a version, meters the plan, and builds the approved plan with the owner's notes", async () => {
    const site = await portfolio("planned");
    const base = await withTenant(a.tenantId, (tx) => latestVersion(tx, site.id));
    const plan = {
      summary: "A calm portfolio for a Patna product designer.",
      assumptions: ["Clients are startups"],
      pages: [{ path: "/", title: "Home", sections: ["hero — who Priya is", "collection projects — the work"] }],
      style: { mood: "calm", colors: "keep the brand kit", fonts: "Manrope / Inter", motion: "subtle" as const },
      imagery: "Project screenshots from the media library",
      questions: [],
    };
    const planner = (async () => ({ plan, model: "fake", provider: "bedrock", usage: { input_tokens: 800, output_tokens: 200, cache_read_input_tokens: 0, requests: 2 } })) as never;
    const r = await planVersion(a.tenantId, { siteId: site.id, baseVersionId: base.id, prompt: "portfolio for me", userId: a.userId }, { planner });
    expect(r.plan.summary).toMatch(/calm portfolio/);
    expect((await withTenant(a.tenantId, (tx) => latestVersion(tx, site.id))).id).toBe(base.id);
    const plans = await withTenant(a.tenantId, (tx) => tx.query<{ outcome: string; version_id: string | null }>("select outcome, version_id from ai_usage where site_id = $1", [site.id]));
    expect(plans).toEqual([{ outcome: "plan", version_id: null }]);

    let told = "";
    const created = await generateVersion(
      a.tenantId,
      { siteId: site.id, baseVersionId: base.id, prompt: "portfolio for me", userId: a.userId, plan: parsePlan(JSON.stringify(plan)), planNotes: "Add a stats row." },
      { editor: fakeEditor((o) => ((told = o.prompt), {})) },
    );
    expect(told).toContain("portfolio for me");
    expect(told).toContain("Approved plan");
    expect(told).toContain("Add a stats row.");
    // The version remembers what was asked, not the whole brief.
    expect((await withTenant(a.tenantId, (tx) => latestVersion(tx, site.id))).prompt).toBe("portfolio for me");
    expect(created.number).toBe(base.number + 1);
    expect(() => parsePlan('{"summary":"x"}')).toThrow(/could not be read/);
  });
});

describe("brand kit", () => {
  it("keeps what the owner fixed whatever the AI does, and records what the AI chose", async () => {
    const site = await portfolio("brand", parseBrand({ colors: { primary: "#123456" }, fonts: { heading: "Lora" } }));
    expect((await withTenant(a.tenantId, (tx) => latestVersion(tx, site.id))).tree!.theme.colors.primary).toBe("#123456");
    const base = await withTenant(a.tenantId, (tx) => latestVersion(tx, site.id));
    let locked: string[] = [];
    const made = await generateVersion(
      a.tenantId,
      { siteId: site.id, baseVersionId: base.id, prompt: "Make it green", userId: a.userId },
      {
        editor: fakeEditor((o) => {
          locked = o.capabilities?.lockedTheme ?? [];
          return { tree: applyOps(o.tree, [{ op: "setTheme", theme: { colors: { primary: "#00ff00", accent: "#ff00aa" }, fonts: { heading: "Poppins" } } }]) };
        }),
      },
    );
    expect(locked).toEqual(expect.arrayContaining(["colors.primary", "fonts.heading"]));
    const v = await withTenant(a.tenantId, (tx) => latestVersion(tx, site.id));
    expect(v.id).toBe(made.id);
    expect(v.tree!.theme.colors.primary).toBe("#123456"); // fixed
    expect(v.tree!.theme.fonts.heading).toBe("Lora"); // fixed
    expect(v.tree!.theme.colors.accent).toBe("#ff00aa"); // the AI's to choose
    const after = await withTenant(a.tenantId, (tx) => getSite(tx, site.id));
    expect(after.brand.aiColors?.accent).toBe("#ff00aa");

    const saved = await withTenant(a.tenantId, (tx) => saveBrand(tx, site.id, parseBrand({ colors: { primary: "#abcdef" }, logo: "https://assets.test/logo.png" }), a.userId));
    expect(saved.version).not.toBeNull();
    const branded = await withTenant(a.tenantId, (tx) => latestVersion(tx, site.id));
    expect(branded.tree!.theme.colors.primary).toBe("#abcdef");
    expect(branded.tree!.nav.logo).toBe("https://assets.test/logo.png");
  });
});

describe("versioned data", () => {
  it("starts a portfolio with its profile, applies AI additions, holds overwrites as proposals, and restores table by table", async () => {
    const site = await portfolio("data");
    const v1 = await withTenant(a.tenantId, (tx) => latestVersion(tx, site.id));
    expect(v1.data.profile?.[0]).toMatchObject({ name: "Priya Studio" });
    expect(v1.data.projects).toHaveLength(3);

    // The AI adds a project (applies) and wants to rename an existing one (proposal).
    const projectId = v1.data.projects![0]!.id!;
    const made = await generateVersion(
      a.tenantId,
      { siteId: site.id, baseVersionId: v1.id, prompt: "Add my new app project and rename the first", userId: a.userId },
      {
        editor: fakeEditor((o) => {
          const add = { op: "addItem" as const, collection: "projects", item: { title: "Chai app" } };
          const rename = { op: "updateItem" as const, collection: "projects", id: projectId, fields: { title: "Renamed" } };
          return {
            operations: [],
            data: applyDataOps(o.data!, [add]),
            dataOperations: [add],
            proposals: [{ op: rename, description: "Change title of Projects “Project one”" }],
          };
        }),
      },
    );
    const v2 = await withTenant(a.tenantId, (tx) => latestVersion(tx, site.id));
    expect(v2.id).toBe(made.id);
    expect(v2.data.projects!.map((p) => p.title)).toEqual(["Project one", "Project two", "Project three", "Chai app"]);
    expect((v2.ai_meta as { proposals: unknown[] }).proposals).toHaveLength(1);

    // Allowed: a new version applies it; v2 keeps the old data as the backup.
    const v3n = await applyProposals(a.tenantId, site.id, v2.number, [0], a.userId);
    const v3 = await withTenant(a.tenantId, (tx) => latestVersion(tx, site.id));
    expect(v3.number).toBe(v3n.number);
    expect(v3.data.projects![0]!.title).toBe("Renamed");

    // A manual edit to skills.
    await withTenant(a.tenantId, (tx) => editData(tx, site.id, [{ op: "addItem", collection: "skills", item: { name: "Figma" } }], a.userId));
    const v4 = await withTenant(a.tenantId, (tx) => latestVersion(tx, site.id));
    expect(v4.data.skills!.map((s) => s.name)).toContain("Figma");
    expect(v4.source).toBe("manual");

    // Going back to v1: reset projects only; skills keep Figma.
    await withTenant(a.tenantId, (tx) => restoreVersion(tx, site.id, v1.id, a.userId, { restoreLayout: false, resetCollections: ["projects"] }));
    const v5 = await withTenant(a.tenantId, (tx) => latestVersion(tx, site.id));
    expect(v5.data.projects!.map((p) => p.title)).toEqual(["Project one", "Project two", "Project three"]);
    expect(v5.data.skills!.map((s) => s.name)).toContain("Figma");
    expect(v5.summary).toMatch(/reset projects from version 1/);
  });
});

describe("export, delete and import", () => {
  it("refuses to delete without a fresh export, deletes after one, and imports it back whole", async () => {
    const site = await portfolio("moving");
    const asset = await uploadAsset(a.tenantId, { bytes: PNG, alt: "Me", siteId: site.id, userId: a.userId });
    await withTenant(a.tenantId, (tx) =>
      editData(tx, site.id, [{ op: "updateItem", collection: "profile", fields: { photo: asset.url } }], a.userId),
    );
    await expect(deleteSite(a.tenantId, site.id, site.name)).rejects.toThrow(/export/);

    const exported = await exportSite(a.tenantId, site.id);
    const files = unzipSync(exported.bytes);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["zuuvy-site-archive.json", "versions/0001.json", "versions/0002.data.json", "current/zuuvy-site.json"]));
    expect(Object.keys(files).some((p) => p.startsWith("assets/"))).toBe(true);
    expect((await withTenant(a.tenantId, (tx) => deletionCheck(tx, site.id))).ok).toBe(true);

    // A version after the export makes it stale.
    await withTenant(a.tenantId, (tx) => editData(tx, site.id, [{ op: "addItem", collection: "skills", item: { name: "Late" } }], a.userId));
    await expect(deleteSite(a.tenantId, site.id, site.name)).rejects.toThrow(/after the last export/);
    const fresh = await exportSite(a.tenantId, site.id);
    await expect(deleteSite(a.tenantId, site.id, "wrong name")).rejects.toThrow(/exactly/);
    await deleteSite(a.tenantId, site.id, site.name);
    expect(await withTenant(a.tenantId, (tx) => tx.one("select id from sites where id = $1", [site.id]))).toBeUndefined();

    const back = await importSite(a.tenantId, { name: "Priya again", subdomain: "moved-back", bytes: fresh.bytes, userId: a.userId });
    const head = await withTenant(a.tenantId, (tx) => latestVersion(tx, back.id));
    expect(head.number).toBe(3);
    expect(head.data.skills!.map((s) => s.name)).toContain("Late");
    // The picture was stored again for the new site, and the URL rewritten.
    expect(head.data.profile![0]!.photo).not.toBe(asset.url);
    expect(String(head.data.profile![0]!.photo)).toMatch(/^https:\/\/assets\.test\/t\//);
  });

  it("round-trips a revision's source through an edit", async () => {
    const site = await portfolio("source");
    const { bytes } = await exportRevision(a.tenantId, site.id, 1);
    const files = Object.fromEntries(Object.entries(unzipSync(bytes)).map(([p, b]) => [p, new TextDecoder().decode(b)]));
    const metaPath = Object.keys(files).find((p) => p.endsWith("site/meta.json"))!;
    const meta = JSON.parse(files[metaPath]!);
    meta.title = "Edited by hand";
    files[metaPath] = JSON.stringify(meta);
    const projectsPath = Object.keys(files).find((p) => p.endsWith("site/data/projects.json"))!;
    files[projectsPath] = JSON.stringify([{ id: "x1", title: "Only one" }]);
    const edited = zipSync(Object.fromEntries(Object.entries(files).map(([p, c]) => [p, strToU8(c)])));
    const v = await importRevision(a.tenantId, site.id, edited, a.userId);
    const head = await withTenant(a.tenantId, (tx) => latestVersion(tx, site.id));
    expect(head.number).toBe(v.number);
    expect(head.tree!.meta.title).toBe("Edited by hand");
    expect(head.data.projects).toEqual([{ id: "x1", title: "Only one" }]);

    files[metaPath] = "{ not json";
    await expect(importRevision(a.tenantId, site.id, zipSync(Object.fromEntries(Object.entries(files).map(([p, c]) => [p, strToU8(c)]))), a.userId)).rejects.toThrow(/meta\.json is not valid JSON/);
  });
});

describe("site type and inventory", () => {
  it("sells studio products with counted stock, and none-mode never sells out", async () => {
    const shop = await withTenant(a.tenantId, (tx) =>
      createSite(tx, { name: "Shop", subdomain: "priya-shop", templateId: "store-classic", templateInput: { businessName: "Priya" }, userId: a.userId }),
    );
    await expect(withTenant(a.tenantId, (tx) => setInventory(tx, shop.id, "source", "zuuvy"))).rejects.toThrow(/Connect a data source/);
    await withTenant(a.tenantId, (tx) => setInventory(tx, shop.id, "studio", null));
    const product = await withTenant(a.tenantId, (tx) => createProduct(tx, { name: "Tote bag", price: 499, stock: 2 }));
    const tree = (await withTenant(a.tenantId, (tx) => latestVersion(tx, shop.id))).tree!;
    const shown = await storefrontData({ tenantId: a.tenantId, siteId: shop.id }, tree);
    expect(shown.map((p) => p.id)).toEqual([product.id]);

    const customer = { name: "Ravi", phone: "9876543210", address: "12 Boring Road, Patna" };
    const o1 = await placeOrder(a.tenantId, { siteId: shop.id, customer, lines: [{ productId: product.id, quantity: 2 }] });
    const o2 = await placeOrder(a.tenantId, { siteId: shop.id, customer, lines: [{ productId: product.id, quantity: 1 }] });
    await advanceOrder(a.tenantId, o1.id, "confirmed");
    expect(await withTenant(a.tenantId, (tx) => tx.get<{ stock: number; in_stock: boolean }>("select stock, in_stock from products where id = $1", [product.id]))).toMatchObject({ stock: 0, in_stock: false });
    await expect(advanceOrder(a.tenantId, o2.id, "confirmed")).rejects.toThrow(/Not enough Tote bag/);
    await advanceOrder(a.tenantId, o1.id, "cancelled");
    expect((await withTenant(a.tenantId, (tx) => tx.get<{ stock: number }>("select stock from products where id = $1", [product.id]))).stock).toBe(2);
    expect((await withTenant(a.tenantId, (tx) => getOrder(tx, o1.id))).events.map((e) => e.status)).toEqual(["pending", "confirmed", "cancelled"]);

    // None: stock is ignored entirely.
    await withTenant(a.tenantId, (tx) => tx.query("update products set stock = 0, in_stock = false where id = $1", [product.id]));
    await withTenant(a.tenantId, (tx) => setInventory(tx, shop.id, "none", null));
    const o3 = await placeOrder(a.tenantId, { siteId: shop.id, customer, lines: [{ productId: product.id, quantity: 5 }] });
    await advanceOrder(a.tenantId, o3.id, "confirmed");

    // Not a store: no products, no orders.
    await withTenant(a.tenantId, (tx) => setSiteKind(tx, shop.id, "landing"));
    expect(await storefrontData({ tenantId: a.tenantId, siteId: shop.id }, tree)).toEqual([]);
    await expect(placeOrder(a.tenantId, { siteId: shop.id, customer, lines: [{ productId: product.id, quantity: 1 }] })).rejects.toThrow(/does not take orders/);
  });

  it("shows, hides or keeps selling out-of-stock products, and returns exactly what accepting took", async () => {
    const shop = await withTenant(a.tenantId, (tx) =>
      createSite(tx, { name: "Oos", subdomain: "priya-oos", templateId: "store-classic", templateInput: { businessName: "Priya" }, userId: a.userId }),
    );
    await withTenant(a.tenantId, (tx) => setInventory(tx, shop.id, "studio", null));
    const lamp = await withTenant(a.tenantId, (tx) => createProduct(tx, { name: "Brass lamp", price: 1299, stock: 1 }));
    const vase = await withTenant(a.tenantId, (tx) => createProduct(tx, { name: "Clay vase", price: 399, stock: 0 }));
    const tree = (await withTenant(a.tenantId, (tx) => latestVersion(tx, shop.id))).tree!;
    const site = { tenantId: a.tenantId, siteId: shop.id };
    const customer = { name: "Ravi", phone: "9876543210", address: "12 Boring Road, Patna" };
    const stock = async (id: string) => (await withTenant(a.tenantId, (tx) => tx.get<{ stock: number }>("select stock from products where id = $1", [id]))).stock;

    // show (the default): listed, not orderable.
    expect((await storefrontData(site, tree)).map((p) => p.name)).toEqual(expect.arrayContaining(["Brass lamp", "Clay vase"]));
    await expect(placeOrder(a.tenantId, { siteId: shop.id, customer, lines: [{ productId: vase.id, quantity: 1 }] })).rejects.toThrow(/out of stock/);

    // hide: gone from the store, still not orderable.
    await withTenant(a.tenantId, (tx) => setOutOfStock(tx, shop.id, "hide"));
    const hidden = (await storefrontData(site, tree)).map((p) => p.name);
    expect(hidden).toContain("Brass lamp");
    expect(hidden).not.toContain("Clay vase");
    expect(await storefrontProduct(site, vase.id)).toBeNull();

    // sell: orderable beyond stock; accepting takes what is there and cancelling returns only that.
    await withTenant(a.tenantId, (tx) => setOutOfStock(tx, shop.id, "sell"));
    expect((await storefrontProduct(site, vase.id))?.backorders).toBe(true);
    const order = await placeOrder(a.tenantId, { siteId: shop.id, customer, lines: [{ productId: lamp.id, quantity: 3 }, { productId: vase.id, quantity: 2 }] });
    await advanceOrder(a.tenantId, order.id, "confirmed");
    expect(await stock(lamp.id)).toBe(0);
    expect(await stock(vase.id)).toBe(0);
    await advanceOrder(a.tenantId, order.id, "cancelled");
    expect(await stock(lamp.id)).toBe(1);
    expect(await stock(vase.id)).toBe(0);

    await expect(withTenant(a.tenantId, (tx) => setOutOfStock(tx, shop.id, "later"))).rejects.toThrow(/out-of-stock/);
  });
});

describe("email", () => {
  it("queues order alerts to the chosen addresses, from alerts@", async () => {
    await withTenant(a.tenantId, (tx) => setAlerts(tx, { orders: true, emails: ["owner@studio.test", "OWNER@studio.test", "ops@studio.test"] }));
    expect((await withTenant(a.tenantId, getAlerts)).emails).toEqual(["owner@studio.test", "ops@studio.test"]);
    const shop = await withTenant(a.tenantId, (tx) =>
      createSite(tx, { name: "Shop 2", subdomain: "priya-shop-2", templateId: "store-classic", templateInput: { businessName: "Priya" }, userId: a.userId }),
    );
    await withTenant(a.tenantId, (tx) => setInventory(tx, shop.id, "none", null));
    const product = await withTenant(a.tenantId, (tx) => createProduct(tx, { name: "Mug", price: 250 }));
    sentForTests.length = 0;
    await placeOrder(a.tenantId, { siteId: shop.id, customer: { name: "Ravi", phone: "9876543210", address: "12 Boring Road, Patna" }, lines: [{ productId: product.id, quantity: 1 }] });
    await drainOutbox(HANDLERS);
    const alerts = sentForTests.filter((e) => e.from === "alerts");
    expect(alerts.map((e) => e.to).sort()).toEqual(["ops@studio.test", "owner@studio.test"]);
    expect(alerts[0]!.subject).toMatch(/New order WEB-\d+ — ₹250/);
  });
});

describe("custom domains", () => {
  it("requests a certificate, waits for DNS, attaches it and goes live; removal releases it", async () => {
    const calls: string[] = [];
    let issued = false;
    setDomainProvider({
      requestCertificate: async (host) => (calls.push(`request ${host}`), "arn:cert:1"),
      describeCertificate: async () => ({ status: issued ? "ISSUED" : "PENDING_VALIDATION", validation: { name: "_x.www.priya.in.", value: "_y.acm-validations.aws." }, failure: null }),
      attach: async (arn) => void calls.push(`attach ${arn}`),
      detach: async (arn) => void calls.push(`detach ${arn}`),
      deleteCertificate: async (arn) => void calls.push(`delete ${arn}`),
    });
    let pointed = false;
    setDnsChecker(async () => ({ ok: pointed, found: pointed ? ["domains.zuuvy.site"] : [] }));
    const site = await portfolio("domain");
    await expect(addDomain(a.tenantId, site.id, "shop.zuuvy.site", a.userId)).rejects.toThrow(/Zuuvy address/);
    await expect(addDomain(a.tenantId, site.id, "10.0.0.1", a.userId)).rejects.toThrow(/IP address/);
    const d = await addDomain(a.tenantId, site.id, "https://WWW.Priya.in/about", a.userId);
    expect(d.hostname).toBe("www.priya.in");
    await expect(addDomain(a.tenantId, site.id, "www.priya.in", a.userId)).rejects.toThrow(/already connected/);

    await drainOutbox(HANDLERS); // provision
    let [row] = await withTenant(a.tenantId, (tx) => listDomains(tx, site.id));
    expect(row).toMatchObject({ status: "verifying", certificate_arn: "arn:cert:1", validation_name: "_x.www.priya.in." });

    await checkDomainNow(a.tenantId, d.id);
    await drainOutbox(HANDLERS);
    [row] = await withTenant(a.tenantId, (tx) => listDomains(tx, site.id));
    expect(row!.status).toBe("verifying");
    expect(row!.last_error).toMatch(/validation record/);

    issued = true;
    pointed = true;
    await checkDomainNow(a.tenantId, d.id);
    await drainOutbox(HANDLERS);
    [row] = await withTenant(a.tenantId, (tx) => listDomains(tx, site.id));
    expect(row).toMatchObject({ status: "active", attached: true });
    expect(calls).toEqual(["request www.priya.in", "attach arn:cert:1"]);

    const { resolveHost, removeDomain } = await import("./index");
    expect(await resolveHost("www.priya.in")).toEqual({ tenantId: a.tenantId, siteId: site.id });
    await removeDomain(a.tenantId, d.id);
    await drainOutbox(HANDLERS);
    expect(calls.slice(-2)).toEqual(["detach arn:cert:1", "delete arn:cert:1"]);
    expect(await resolveHost("www.priya.in")).toBeNull();
  });
});

describe("the platform's own root", () => {
  it("only a platform admin connects zuuvy.site, with no certificate, and the renderer then serves it", async () => {
    const calls: string[] = [];
    setDomainProvider({
      requestCertificate: async () => (calls.push("request"), "arn:x"),
      describeCertificate: async () => ({ status: "ISSUED", validation: null, failure: null }),
      attach: async () => void calls.push("attach"),
      detach: async () => {},
      deleteCertificate: async () => {},
    });
    setDnsChecker(async () => ({ ok: true, found: ["1.2.3.4"] }));
    const site = await portfolio("landing-root");
    await expect(addDomain(a.tenantId, site.id, "zuuvy.site", a.userId)).rejects.toThrow(/Zuuvy address/);
    await expect(addDomain(a.tenantId, site.id, "shop.zuuvy.site", a.userId, { platformAdmin: true })).rejects.toThrow(/Zuuvy address/);
    const d = await addDomain(a.tenantId, site.id, "https://zuuvy.site/", a.userId, { platformAdmin: true });
    expect(d.hostname).toBe("zuuvy.site");
    await drainOutbox(HANDLERS); // provision → check
    await drainOutbox(HANDLERS);
    const [row] = await withTenant(a.tenantId, (tx) => listDomains(tx, site.id));
    expect(row!.status).toBe("active");
    expect(calls).toEqual([]); // the platform certificate already covers it
    const { resolveHost } = await import("./index");
    expect(await resolveHost("zuuvy.site")).toEqual({ tenantId: a.tenantId, siteId: site.id });
    expect(await resolveHost("www.zuuvy.site")).toBeNull();
  });
});

describe("GitHub sync", () => {
  it("pushes each version as a branch and publishing moves main by a merge commit", async () => {
    const refs = new Map<string, string>();
    const commits = new Map<string, { tree: string; parents: string[]; message: string }>();
    let n = 0;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    setGitHubFetch((async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname.replace("/repos/priya/site", "");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (path === "" && method === "GET") return json(200, { default_branch: "main", permissions: { push: true } });
      if (path.startsWith("/git/ref/heads/")) {
        const sha = refs.get(path.slice("/git/ref/heads/".length));
        return sha ? json(200, { object: { sha } }) : json(404, { message: "Not Found" });
      }
      if (path === "/contents/README.md") {
        commits.set("c0", { tree: "t0", parents: [], message: "init" });
        refs.set("main", "c0");
        return json(201, {});
      }
      if (path.startsWith("/git/commits/") && method === "GET") return json(200, { tree: { sha: commits.get(path.split("/").pop()!)!.tree } });
      if (path.startsWith("/git/trees/") && method === "GET") return json(200, { tree: [] });
      if (path === "/git/trees") return json(201, { sha: `t${++n}` });
      if (path === "/git/commits") {
        const sha = `c${++n}`;
        commits.set(sha, body);
        return json(201, { sha });
      }
      if (path === "/git/refs") {
        refs.set(body.ref.replace("refs/heads/", ""), body.sha);
        return json(201, {});
      }
      if (path.startsWith("/git/refs/heads/")) {
        refs.set(path.slice("/git/refs/heads/".length), body.sha);
        return json(200, {});
      }
      return json(404, { message: `unexpected ${method} ${path}` });
    }) as typeof fetch);

    const site = await portfolio("git");
    await connectGit(a.tenantId, site.id, { repo: "https://github.com/priya/site", token: `github_pat_${"x".repeat(30)}` }, a.userId);
    await drainOutbox(HANDLERS);
    expect(refs.has("zuuvy/v1")).toBe(true);
    const mainAfterConnect = commits.get(refs.get("main")!)!;
    expect(mainAfterConnect.message).toMatch(/Publish v1/);
    expect(mainAfterConnect.parents).toHaveLength(2);

    await withTenant(a.tenantId, (tx) => editData(tx, site.id, [{ op: "addItem", collection: "skills", item: { name: "Git" } }], a.userId));
    await drainOutbox(HANDLERS);
    expect(refs.has("zuuvy/v2")).toBe(true);
    const { publishVersion, getVersionByNumber } = await import("./index");
    await withTenant(a.tenantId, async (tx) => publishVersion(tx, site.id, (await getVersionByNumber(tx, site.id, 2)).id, a.userId));
    await drainOutbox(HANDLERS);
    const main = commits.get(refs.get("main")!)!;
    expect(main.message).toMatch(/Publish v2/);
    expect(main.parents).toContain(refs.get("zuuvy/v2"));
    const link = await withTenant(a.tenantId, (tx) => tx.one<{ status: string; credentials: string }>("select status, credentials from site_git where site_id = $1", [site.id]));
    expect(link!.status).toBe("active");
    expect(link!.credentials).not.toContain("github_pat_"); // sealed
  });
});

describe("platform admins", () => {
  it("only a superadmin adds or removes admins, and the last superadmin stays", async () => {
    const boss = await signup({ businessName: "Zuuvy", name: "Rishav", email: "rishav@zuuvy.test", password: "password-r" });
    // What scripts/create-superadmin.ts does: the owner role writes the first row.
    const owner = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
    await owner.connect();
    await owner.query("insert into platform_admins (user_id, role) values ($1, 'superadmin')", [boss.userId]);
    await owner.end();
    // The application role cannot write the table directly.
    await expect(withGlobal((tx) => tx.query("insert into platform_admins (user_id, role) values ($1, 'superadmin')", [a.userId]))).rejects.toThrow(/permission denied/);

    expect(await isPlatformAdmin(boss.userId)).toBe(true);
    expect(await isPlatformAdmin(a.userId)).toBe(false);
    const made = await addPlatformAdmin(boss.userId, { email: "new.admin@zuuvy.test", name: "New Admin", role: "admin" });
    expect(made.created).toBe(true);
    expect(made.password).toBeTruthy();
    const promoted = await addPlatformAdmin(boss.userId, { email: "priya@studio.test", role: "admin" });
    expect(promoted.created).toBe(false);
    expect((await listPlatformAdmins()).map((x) => x.email).sort()).toEqual(["new.admin@zuuvy.test", "priya@studio.test", "rishav@zuuvy.test"]);

    await expect(addPlatformAdmin(a.userId, { email: "x@y.test", role: "admin" })).rejects.toThrow(/superadmin/);
    await expect(removePlatformAdmin(a.userId, boss.userId)).rejects.toThrow(/superadmin/);
    await expect(removePlatformAdmin(boss.userId, boss.userId)).rejects.toThrow(/yourself/);
    await removePlatformAdmin(boss.userId, a.userId);
    expect(await isPlatformAdmin(a.userId)).toBe(false);
  });
});
