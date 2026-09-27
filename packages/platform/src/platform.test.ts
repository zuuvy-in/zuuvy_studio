import { type MockZuuvy, startMockZuuvy } from "@zsite/connectors/zuuvy/mock";
import { signZuuvyWebhook } from "@zsite/connectors";
import { applyOps } from "@zsite/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  HANDLERS,
  UserError,
  compareVersions,
  connectIntegration,
  createSession,
  createSite,
  disconnectIntegration,
  drainOutbox,
  generateVersion,
  getOrder,
  getSession,
  handleWebhook,
  latestVersion,
  listEvents,
  listPublications,
  listSites,
  listVersions,
  login,
  orderByToken,
  placeOrder,
  publishVersion,
  resolveHost,
  restoreVersion,
  signup,
  storefrontProducts,
  withGlobal,
  withTenant,
} from "./index";
import { createTestDatabase, startHookServer } from "./testing";

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let a: { userId: string; tenantId: string };
let b: { userId: string; tenantId: string };

beforeAll(async () => {
  db = await createTestDatabase();
  a = await signup({ businessName: "Demo Mobiles", name: "Asha", email: "asha@demo.test", password: "password-a" });
  b = await signup({ businessName: "Other Shop", name: "Bala", email: "bala@other.test", password: "password-b" });
});
afterAll(async () => {
  await db?.drop();
});

const storeInput = (name: string, subdomain: string, userId: string) => ({
  name,
  subdomain,
  templateId: "store-classic",
  templateInput: { businessName: name },
  userId,
});

describe("accounts", () => {
  it("signs in and resolves a session to its tenant", async () => {
    const who = await login("ASHA@demo.test", "password-a");
    expect(who.tenantId).toBe(a.tenantId);
    const { token } = await createSession(who.userId, who.tenantId);
    const session = await getSession(token);
    expect(session?.tenant.name).toBe("Demo Mobiles");
    expect(session?.role).toBe("owner");
    expect(await getSession("nope")).toBeNull();
  });

  it("refuses a wrong password and an existing email", async () => {
    await expect(login("asha@demo.test", "wrong")).rejects.toThrow(UserError);
    await expect(
      signup({ businessName: "Xy Shop", name: "Y", email: "asha@demo.test", password: "whatever-123" }),
    ).rejects.toThrow(/already has an account/);
  });
});

describe("tenant isolation (row-level security)", () => {
  it("never shows one tenant's rows to another, nor to a context-less query", async () => {
    await withTenant(a.tenantId, (tx) => createSite(tx, storeInput("Demo store", "demo-store", a.userId)));
    await withTenant(b.tenantId, (tx) => createSite(tx, storeInput("Other store", "other-store", b.userId)));

    const aSites = await withTenant(a.tenantId, listSites);
    const bSites = await withTenant(b.tenantId, listSites);
    expect(aSites.map((s) => s.subdomain)).toEqual(["demo-store"]);
    expect(bSites.map((s) => s.subdomain)).toEqual(["other-store"]);

    // A query with no tenant set — the bug RLS exists to contain — sees nothing.
    const leaked = await withGlobal((tx) => tx.query("select id from sites"));
    expect(leaked).toEqual([]);

    // Even naming another tenant's row by id finds nothing.
    const bSiteId = bSites[0]!.id;
    const peek = await withTenant(a.tenantId, (tx) => tx.query("select id from sites where id = $1", [bSiteId]));
    expect(peek).toEqual([]);

    // And writing a row into another tenant is refused.
    await expect(
      withTenant(a.tenantId, (tx) =>
        tx.query("insert into outbox (tenant_id, topic, payload) values ($1, 'x', '{}')", [b.tenantId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("keeps versions immutable for the app role", async () => {
    await expect(
      withTenant(a.tenantId, (tx) => tx.query("update site_versions set summary = 'rewritten'")),
    ).rejects.toThrow(/permission denied/);
  });

  it("resolves hosts to the right site", async () => {
    const r = await resolveHost("demo-store.localhost:3001");
    expect(r?.tenantId).toBe(a.tenantId);
    expect(await resolveHost("nobody.zuuvy.site")).toBeNull();
  });

  it("refuses a taken or reserved subdomain", async () => {
    await expect(withTenant(b.tenantId, (tx) => createSite(tx, storeInput("Dup", "demo-store", b.userId)))).rejects.toThrow(/taken/);
    await expect(withTenant(b.tenantId, (tx) => createSite(tx, storeInput("Res", "studio", b.userId)))).rejects.toThrow(/reserved/);
  });
});

describe("versions", () => {
  it("creates, compares, publishes, rolls back and restores", async () => {
    await withTenant(a.tenantId, async (tx) => {
      const [site] = await listSites(tx);
      const v1 = await latestVersion(tx, site!.id);
      expect(v1).toMatchObject({ number: 1, source: "template", is_published: true });

      const tree2 = applyOps(v1.tree!, [{ op: "updateSection", section: "shop", props: { heading: "Bestsellers" } }]);
      const { createVersion } = await import("./sites");
      const v2 = await createVersion(tx, site!.id, { tree: tree2, parentId: v1.id, source: "manual", userId: a.userId });
      expect(v2.number).toBe(2);

      const cmp = await compareVersions(tx, site!.id, v1.id, v2.id);
      expect(cmp.changes.map((c) => c.kind)).toEqual(["section-changed"]);
      expect((await listVersions(tx, site!.id))[0]).toMatchObject({ number: 2, summary: "1 section changed", is_published: false });

      await publishVersion(tx, site!.id, v2.id, a.userId);
      await publishVersion(tx, site!.id, v1.id, a.userId); // roll back
      const pubs = await listPublications(tx, site!.id);
      expect(pubs.map((p) => [p.version_number, p.previous_number])).toEqual([
        [1, 2],
        [2, 1],
        [1, null],
      ]);

      const v3 = await restoreVersion(tx, site!.id, v1.id, a.userId);
      const latest = await latestVersion(tx, site!.id);
      expect(latest).toMatchObject({ id: v3.id, number: 3, source: "restore", parent_number: 2 });
      expect(latest.summary).toBe("Restored version 1");
      expect(latest.tree!.pages[0]!.sections.find((sec) => sec.id === "shop")!.props).toMatchObject({ heading: "Shop the range" });
      await expect(restoreVersion(tx, site!.id, v3.id, a.userId)).rejects.toThrow(/already the latest/);
    });
  });

  it("saves an AI edit as a new unpublished version on its base", async () => {
    const { site, base } = await withTenant(a.tenantId, async (tx) => {
      const [site] = await listSites(tx);
      return { site: site!, base: await latestVersion(tx, site!.id) };
    });
    const fake = async ({ tree, context }: { tree: typeof base.tree & object; context: { businessName: string } }) => ({
      tree: applyOps(tree, [{ op: "setMeta", title: `${context.businessName} — shop online` }]),
      operations: [{ op: "setMeta" as const, title: "x" }],
      summary: "Retitled the site.",
      model: "fake-model",
      provider: "bedrock" as const,
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, requests: 1 },
      stopReason: "end_turn",
    });
    const made = await generateVersion(
      a.tenantId,
      { siteId: site.id, baseVersionId: base.id, prompt: "Retitle the site", userId: a.userId },
      fake as never,
    );
    const v = await withTenant(a.tenantId, (tx) => latestVersion(tx, site.id));
    expect(v).toMatchObject({ id: made.id, source: "ai", prompt: "Retitle the site", summary: "Retitled the site.", is_published: false });
    expect(v.tree!.meta.title).toBe("Demo Mobiles — shop online");
    expect(v.parent_id).toBe(base.id);
  });
});

describe("Zuuvy, end to end against the mock", () => {
  let mock: MockZuuvy;
  let hooks: Awaited<ReturnType<typeof startHookServer>>;
  let integrationId: string;
  let siteId: string;

  beforeAll(async () => {
    process.env.ZSITE_ALLOW_CUSTOM_ZUUVY_URL = "1";
    mock = await startMockZuuvy();
    hooks = await startHookServer();
    process.env.PUBLIC_API_URL = hooks.url;
    siteId = (await withTenant(a.tenantId, listSites))[0]!.id;
  });
  afterAll(async () => {
    await mock?.close();
    await hooks?.close();
  });

  it("connects, registers its webhook and syncs the catalogue", async () => {
    const r = await connectIntegration(a.tenantId, "zuuvy", { tenant: "demo", apiKey: "zk_test_demo", baseUrl: mock.url });
    integrationId = r.integration.id;
    expect(r.warning).toBeNull();
    expect(r.info.headline).toBe("Demo Mobiles");
    expect(mock.state.webhook?.url).toBe(`${hooks.url}/api/hooks/${integrationId}`);

    await drainOutbox(HANDLERS);
    const products = await withTenant(a.tenantId, (tx) => storefrontProducts(tx, { limit: 50 }));
    expect(products).toHaveLength(10);
    // The other tenant sees none of it.
    expect(await withTenant(b.tenantId, (tx) => storefrontProducts(tx))).toHaveLength(0);
  });

  it("refuses bad credentials in words", async () => {
    await expect(
      connectIntegration(b.tenantId, "zuuvy", { tenant: "demo", apiKey: "zk_wrong", baseUrl: mock.url }),
    ).rejects.toThrow(/refused the key/);
  });

  it("places an order, sends it to Zuuvy, and follows Zuuvy's updates", async () => {
    const charger = (await withTenant(a.tenantId, (tx) => storefrontProducts(tx, { limit: 50 }))).find((p) => p.external_id === "1001")!;
    const stockBefore = charger.stock!;

    const placed = await placeOrder(a.tenantId, {
      siteId,
      lines: [{ productId: charger.id, quantity: 2 }],
      customer: { name: "Ravi Kumar", phone: "+91 98765 43210", address: "12 Boring Road, Patna 800001" },
    });
    expect(placed.number).toBe(1);

    await drainOutbox(HANDLERS);
    let order = await withTenant(a.tenantId, (tx) => getOrder(tx, placed.id));
    expect(order).toMatchObject({ sync_state: "sent", status: "pending", total: 1798, customer: { phone: "9876543210" } });
    expect(mock.state.orders[0]).toMatchObject({ request_id: placed.id, order_ref: "WEB-1" });

    // The business accepts in Zuuvy: stock is reserved there, and both facts come back by webhook.
    await mock.setStatus(order.external_ref!, "accepted");
    order = await withTenant(a.tenantId, (tx) => getOrder(tx, placed.id));
    expect(order.status).toBe("confirmed");
    const after = (await withTenant(a.tenantId, (tx) => storefrontProducts(tx, { limit: 50 }))).find((p) => p.id === charger.id)!;
    expect(after.stock).toBe(stockBefore - 2);

    await mock.setStatus(order.external_ref!, "packed");
    await mock.setStatus(order.external_ref!, "out_for_delivery");
    await mock.setStatus(order.external_ref!, "delivered");

    const pub = await orderByToken(placed.publicToken);
    expect(pub?.order.status).toBe("delivered");
    expect(pub?.order.events.map((e) => e.status)).toEqual(["pending", "confirmed", "packed", "shipped", "delivered"]);
  });

  it("ignores a late, out-of-order update and de-duplicates a repeated delivery", async () => {
    const zOrder = mock.state.orders[0]!;
    const secret = mock.state.webhook!.secret;
    const body = JSON.stringify({
      id: "late-1",
      event: "order.status_changed",
      occurred_at: new Date().toISOString(),
      data: { order_id: zOrder.id, request_id: zOrder.request_id, status: "accepted" },
    });
    const headers = { "x-zuuvy-signature": signZuuvyWebhook(secret, body) };
    expect((await handleWebhook(integrationId, headers, body)).status).toBe(200);
    expect(await handleWebhook(integrationId, headers, body)).toEqual({ status: 200, body: { ok: true, duplicate: true } });
    const order = await withTenant(a.tenantId, (tx) => getOrder(tx, zOrder.request_id));
    expect(order.status).toBe("delivered");

    const events = await withTenant(a.tenantId, (tx) => listEvents(tx, integrationId));
    expect(events.find((e) => e.delivery_id === "late-1")?.status).toBe("ignored");
  });

  it("refuses a forged webhook", async () => {
    const body = JSON.stringify({ id: "f1", event: "order.status_changed", occurred_at: "", data: {} });
    const r = await handleWebhook(integrationId, { "x-zuuvy-signature": signZuuvyWebhook("not-the-secret-xxxxxxxxxxxx", body) }, body);
    expect(r.status).toBe(401);
    expect((await handleWebhook("00000000-0000-0000-0000-000000000000", {}, body)).status).toBe(404);
  });

  it("follows products taken down in Zuuvy", async () => {
    await mock.updateProduct("1002", { listed: false });
    const products = await withTenant(a.tenantId, (tx) => storefrontProducts(tx, { limit: 50 }));
    expect(products.find((p) => p.external_id === "1002")).toBeUndefined();
  });

  it("refuses to oversell, and parks an order Zuuvy will never take", async () => {
    const products = await withTenant(a.tenantId, (tx) => storefrontProducts(tx, { limit: 50 }));
    const powerBank = products.find((p) => p.external_id === "1007")!; // 9 in stock
    await expect(
      placeOrder(a.tenantId, {
        siteId,
        lines: [{ productId: powerBank.id, quantity: 20 }],
        customer: { name: "R", phone: "9876543210", address: "12 Boring Road, Patna" },
      }),
    ).rejects.toThrow(/Only 9/);

    // Zuuvy refuses the key from now on: the push is a permanent failure, recorded on the order.
    const placed = await placeOrder(a.tenantId, {
      siteId,
      lines: [{ productId: powerBank.id, quantity: 1 }],
      customer: { name: "R", phone: "9876543210", address: "12 Boring Road, Patna" },
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      realFetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: "Bearer revoked" } })) as typeof fetch;
    try {
      const r = await drainOutbox(HANDLERS);
      expect(r.dead).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
    }
    const order = await withTenant(a.tenantId, (tx) => getOrder(tx, placed.id));
    expect(order.sync_state).toBe("failed");
    expect(order.events.at(-1)?.status).toBe("sync_failed");
  });

  it("hides Zuuvy's products when disconnected", async () => {
    await disconnectIntegration(a.tenantId, "zuuvy");
    expect(await withTenant(a.tenantId, (tx) => storefrontProducts(tx))).toHaveLength(0);
  });
});
