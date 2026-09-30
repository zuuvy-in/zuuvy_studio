import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addToGroup,
  applyDiscounts,
  checkout,
  combinations,
  createCustomerSession,
  createDiscount,
  createGroup,
  createPlugin,
  createProduct,
  createSite,
  listCustomers,
  listDiscounts,
  listOrders,
  listProducts,
  siteCounts,
  customerFromSession,
  customerOrder,
  customerOrders,
  type Discount,
  generateVariants,
  getGroup,
  latestVersion,
  parseCart,
  parseOptions,
  quoteCart,
  serialiseCart,
  setInventory,
  setPluginTransport,
  setVariants,
  sign,
  signInCustomer,
  signUpCustomer,
  signup,
  storefrontData,
  storefrontGroup,
  updateCart,
  withTenant,
} from "./index";
import { createTestDatabase } from "./testing";

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let a: { userId: string; tenantId: string };
let b: { userId: string; tenantId: string };
let site: { tenantId: string; siteId: string };

beforeAll(async () => {
  db = await createTestDatabase();
  a = await signup({ businessName: "Meera Clothing", name: "Meera", email: "meera@clothes.test", password: "password-m", emailVerified: true });
  b = await signup({ businessName: "Other Shop", name: "Otto", email: "otto@other.test", password: "password-o", emailVerified: true });
  const shop = await withTenant(a.tenantId, (tx) =>
    createSite(tx, { name: "Meera", subdomain: "meera-shop", templateId: "store-classic", templateInput: { businessName: "Meera" }, userId: a.userId }),
  );
  await withTenant(a.tenantId, (tx) => setInventory(tx, shop.id, "studio", null));
  site = { tenantId: a.tenantId, siteId: shop.id };
});
afterAll(async () => {
  setPluginTransport(undefined);
  await db?.drop();
});

const customer = { name: "Ravi Kumar", phone: "9876543210", address: "12 Boring Road, Patna" };

describe("variant groups", () => {
  it("generates every combination once, and shows the group as one thing to shop for", async () => {
    const options = parseOptions("Colour: Red, Blue\nSize: S, M, L\nFit: Slim");
    expect(combinations(options)).toHaveLength(6);
    const group = await withTenant(a.tenantId, (tx) =>
      createGroup(tx, { name: "Linen shirt", category: "Shirts", images: ["https://img.test/shirt-group.jpg"], options }),
    );
    expect((await withTenant(a.tenantId, (tx) => generateVariants(tx, group.id, { price: 1499, stock: 5 }))).created).toBe(6);
    // Running it again adds nothing: the combinations exist.
    expect((await withTenant(a.tenantId, (tx) => generateVariants(tx, group.id, { price: 1499 }))).created).toBe(0);
    const full = await withTenant(a.tenantId, (tx) => getGroup(tx, group.id));
    expect(full.variants.map((v) => v.name)).toContain("Linen shirt — Red / M / Slim");

    const tree = (await withTenant(a.tenantId, (tx) => latestVersion(tx, site.siteId))).tree!;
    const shown = await storefrontData(site, tree);
    expect(shown.filter((p) => p.group?.id === group.id)).toHaveLength(6);
    const page = await storefrontGroup(site, group.id);
    expect(page?.group.images).toEqual(["https://img.test/shirt-group.jpg"]);
    expect(page?.variants).toHaveLength(6);
  });

  it("groups products that already exist, and refuses two variants of one combination", async () => {
    const [x, y] = await withTenant(a.tenantId, async (tx) => [
      await createProduct(tx, { name: "Kurta small", price: 999, stock: 3 }),
      await createProduct(tx, { name: "Kurta large", price: 1099, stock: 3 }),
    ]);
    const group = await withTenant(a.tenantId, (tx) => createGroup(tx, { name: "Cotton kurta", options: [{ name: "Size", values: ["S", "L"] }] }));
    expect(await withTenant(a.tenantId, (tx) => addToGroup(tx, group.id, [x!.id, y!.id]))).toBe(2);
    await expect(
      withTenant(a.tenantId, (tx) =>
        setVariants(tx, group.id, [
          { productId: x!.id, options: { Size: "S" } },
          { productId: y!.id, options: { Size: "S" } },
        ]),
      ),
    ).rejects.toThrow(/both S/);
    await withTenant(a.tenantId, (tx) =>
      setVariants(tx, group.id, [
        { productId: x!.id, options: { Size: "S" } },
        { productId: y!.id, options: { Size: "L" }, price: 1199 },
      ]),
    );
    const full = await withTenant(a.tenantId, (tx) => getGroup(tx, group.id));
    expect(full.variants.find((v) => v.id === y!.id)).toMatchObject({ options: { Size: "L" }, price: 1199 });
    await expect(withTenant(a.tenantId, (tx) => setVariants(tx, group.id, [{ productId: x!.id, options: { Size: "XXL" } }]))).rejects.toThrow(/no value/);
  });
});

describe("discount rules", () => {
  const rule = (over: Partial<Discount>): Discount => ({
    id: over.id ?? "d",
    site_id: null,
    name: "Offer",
    code: null,
    kind: "percent",
    value: 10,
    scope: "all",
    scope_ids: [],
    min_subtotal: null,
    min_quantity: null,
    max_amount: null,
    starts_at: null,
    ends_at: null,
    usage_limit: null,
    used_count: 0,
    once_per_customer: false,
    first_order_only: false,
    stacks: false,
    active: true,
    created_at: new Date(),
    ...over,
  });
  const lines = [
    { productId: "p1", groupId: null, category: "Shirts", quantity: 2, lineTotal: 2000 },
    { productId: "p2", groupId: null, category: "Socks", quantity: 1, lineTotal: 300 },
  ];

  it("picks the best single offer, adds stacking ones, and respects scope, minimums and caps", () => {
    const r = applyDiscounts(
      [
        rule({ id: "a", value: 10 }),
        rule({ id: "b", kind: "fixed", value: 500, min_subtotal: 2000 }),
        rule({ id: "c", scope: "categories", scope_ids: ["socks"], value: 50, stacks: true }),
        rule({ id: "d", value: 50, min_quantity: 10 }),
      ],
      lines,
    );
    expect(r.applied.map((x) => [x.id, x.amount])).toEqual([
      ["b", 500],
      ["c", 150],
    ]);
    expect(r.total).toBe(650);
    expect(applyDiscounts([rule({ value: 50, max_amount: 100 })], lines).total).toBe(100);
  });

  it("explains a code that does not apply, and one that loses to a better offer", () => {
    const code = rule({ id: "code", code: "SAVE5", value: 5 });
    expect(applyDiscounts([code], lines, { code: "nope" }).codeMessage).toBe("That code is not valid.");
    expect(applyDiscounts([code, rule({ id: "auto", value: 20 })], lines, { code: "save5" }).codeMessage).toMatch(/better offer/);
    expect(applyDiscounts([code], lines, { code: "save5" }).codeApplied).toBe(true);
    expect(applyDiscounts([rule({ code: "OLD", ends_at: new Date(Date.now() - 1000) })], lines, { code: "OLD" }).codeMessage).toMatch(/ended/);
    expect(applyDiscounts([rule({ code: "FIRST", first_order_only: true })], lines, { code: "FIRST", buyer: { previousOrders: 1, redeemed: new Set() } }).codeMessage).toMatch(/first order/);
  });
});

describe("customers", () => {
  it("sign up, sign in, and see only their own orders on their own business", async () => {
    const { customerId } = await signUpCustomer(a.tenantId, { name: "Ravi", email: "Ravi@Mail.test", password: "secret-123" });
    await expect(signUpCustomer(a.tenantId, { name: "Ravi", email: "ravi@mail.test", password: "secret-123" })).rejects.toThrow(/already has an account/);
    await expect(signInCustomer(a.tenantId, "ravi@mail.test", "wrong-pass")).rejects.toThrow(/do not match/);
    expect((await signInCustomer(a.tenantId, "RAVI@mail.test", "secret-123")).customerId).toBe(customerId);
    // The same email at another business is a different person, with no account there yet.
    await expect(signInCustomer(b.tenantId, "ravi@mail.test", "secret-123")).rejects.toThrow(/do not match/);

    const { token } = await createCustomerSession(a.tenantId, customerId);
    expect((await customerFromSession(a.tenantId, token))?.email).toBe("ravi@mail.test");
    expect(await customerFromSession(b.tenantId, token)).toBeNull();

    const product = await withTenant(a.tenantId, (tx) => createProduct(tx, { name: "Belt", price: 700, stock: 10 }));
    const mine = await checkout(site, { items: [{ productId: product.id, quantity: 1 }], customer, customerId, field: () => "" });
    await checkout(site, { items: [{ productId: product.id, quantity: 1 }], customer, field: () => "" });
    const list = await customerOrders(a.tenantId, customerId);
    expect(list.map((o) => o.number)).toEqual([mine.number]);
    expect((await customerOrder(a.tenantId, customerId, mine.number))?.events[0]?.status).toBe("pending");
    const other = await signUpCustomer(a.tenantId, { name: "Sita", email: "sita@mail.test", password: "secret-123" });
    expect(await customerOrder(a.tenantId, other.customerId, mine.number)).toBeNull();
  });
});

describe("cart, checkout and plugins", () => {
  it("keeps a tidy cart", () => {
    const id = "6f1c1c1e-1111-4111-8111-111111111111";
    expect(parseCart("garbage")).toEqual([]);
    expect(parseCart(JSON.stringify([{ p: id, q: 2 }, { p: id, q: 3 }, { p: "x", q: 1 }]))).toEqual([{ productId: id, quantity: 5 }]);
    const cart = updateCart([], id, 2, "add");
    expect(updateCart(cart, id, 0, "set")).toEqual([]);
    expect(parseCart(serialiseCart(cart))).toEqual(cart);
  });

  it("prices with discounts and plugin adjustments, asks plugin questions, and lets a plugin stop an order", async () => {
    const calls: { hook: string; signature: string; body: string }[] = [];
    let refuse = false;
    setPluginTransport(async (_url, body, headers) => {
      calls.push({ hook: headers["x-zuuvy-hook"]!, signature: headers["x-zuuvy-signature"]!, body });
      const hook = headers["x-zuuvy-hook"];
      if (hook === "cart.calculate") return { status: 200, json: { adjustments: [{ label: "Gift wrap", amount: 49 }], messages: [{ text: "You earn 12 points", tone: "success" }] } };
      if (hook === "checkout.fields") return { status: 200, json: { fields: [{ name: "gstin", label: "GSTIN", required: true }] } };
      if (hook === "checkout.validate") return { status: 200, json: refuse ? { ok: false, error: "We do not deliver to that pincode." } : { ok: true } };
      return { status: 200, json: {} };
    });
    const { secret } = await withTenant(a.tenantId, (tx) =>
      createPlugin(tx, { name: "Loyalty", url: "https://plugin.example.com/hook", hooks: ["cart.calculate", "checkout.fields", "checkout.validate", "order.placed"] }),
    );
    await withTenant(a.tenantId, (tx) => createDiscount(tx, { name: "Ten off", code: "TEN", kind: "percent", value: 10, usageLimit: 1 }));
    const product = await withTenant(a.tenantId, (tx) => createProduct(tx, { name: "Scarf", price: 1000, stock: 10 }));
    const items = [{ productId: product.id, quantity: 2 }];

    const quote = await quoteCart(site, items, { code: "ten", plugins: true, fields: true });
    expect(quote).toMatchObject({ subtotal: 2000, discount: 200, total: 1849, codeApplied: true, ready: true });
    expect(quote.messages[0]?.text).toBe("You earn 12 points");
    expect(quote.fields.map((f) => f.name)).toEqual(["gstin"]);

    // Signed with the plugin's secret, so it can tell the call came from us.
    const c = calls[0]!;
    const [, t, v1] = c.signature.match(/^t=(\d+),v1=([0-9a-f]+)$/)!;
    expect(createHmac("sha256", secret).update(`${t}.${c.body}`).digest("hex")).toBe(v1);
    expect(sign(secret, c.body, Number(t))).toBe(c.signature);

    await expect(checkout(site, { items, customer, code: "TEN", field: () => "" })).rejects.toThrow(/GSTIN/);
    refuse = true;
    await expect(checkout(site, { items, customer, code: "TEN", field: (n) => (n === "x_gstin" ? "10ABCDE1234F1Z5" : "") })).rejects.toThrow(/pincode/);
    refuse = false;
    const placed = await checkout(site, { items, customer, code: "TEN", field: (n) => (n === "x_gstin" ? "10ABCDE1234F1Z5" : "") });
    const order = await withTenant(a.tenantId, (tx) =>
      tx.get<{ total: number; discount: number; extra: Record<string, string>; adjustments: unknown[] }>("select total, discount, extra, adjustments from orders where id = $1", [placed.id]),
    );
    expect(order).toMatchObject({ total: 1849, discount: 200, extra: { gstin: "10ABCDE1234F1Z5" } });
    const jobs = await withTenant(a.tenantId, (tx) => tx.query<{ topic: string }>("select topic from outbox where payload->>'orderId' = $1", [placed.id]));
    expect(jobs.map((j) => j.topic)).toContain("plugin.notify");

    // The code had one use, and it is gone.
    await expect(checkout(site, { items, customer, code: "TEN", field: (n) => (n === "x_gstin" ? "x" : "") })).rejects.toThrow(/run out/);

    // A plugin that fails is skipped, never fatal.
    setPluginTransport(async () => {
      throw new Error("connection refused");
    });
    expect((await quoteCart(site, items, { plugins: true })).total).toBe(2000);
    setPluginTransport(undefined);
  });

  it("will not sell more than there is, unless the store sells out of stock", async () => {
    const product = await withTenant(a.tenantId, (tx) => createProduct(tx, { name: "Last cap", price: 300, stock: 1 }));
    const quote = await quoteCart(site, [{ productId: product.id, quantity: 3 }]);
    expect(quote.ready).toBe(false);
    expect(quote.lines[0]?.problem).toBe("Only 1 left");
  });
});

describe("each store keeps its own", () => {
  it("sells only its own and the shared products, applies only its own and shared offers, and lists its own people", async () => {
    const other = await withTenant(a.tenantId, (tx) =>
      createSite(tx, { name: "Meera Kids", subdomain: "meera-kids", templateId: "store-classic", templateInput: { businessName: "Meera" }, userId: a.userId }),
    );
    await withTenant(a.tenantId, (tx) => setInventory(tx, other.id, "studio", null));
    const second = { tenantId: a.tenantId, siteId: other.id };
    const [mine, shared] = await withTenant(a.tenantId, async (tx) => [
      await createProduct(tx, { name: "Kids tee", price: 300, siteId: other.id }),
      await createProduct(tx, { name: "Gift card", price: 500, siteId: null }),
    ]);
    const firstTree = (await withTenant(a.tenantId, (tx) => latestVersion(tx, site.siteId))).tree!;
    const secondTree = (await withTenant(a.tenantId, (tx) => latestVersion(tx, other.id))).tree!;
    const names = async (r: typeof site, tree: typeof firstTree) => (await storefrontData(r, tree)).map((p) => p.name);
    expect(await names(second, secondTree)).toEqual(expect.arrayContaining(["Kids tee", "Gift card"]));
    expect(await names(site, firstTree)).not.toContain("Kids tee");
    expect(await names(site, firstTree)).toContain("Gift card");
    // Not by guessing an id either.
    const q = await quoteCart(site, [{ productId: mine!.id, quantity: 1 }]);
    expect(q.ready).toBe(false);
    expect(q.lines[0]?.problem ?? "gone").toBeTruthy();

    await withTenant(a.tenantId, (tx) => createDiscount(tx, { name: "Kids week", kind: "percent", value: 20, siteId: other.id }));
    const kids = await quoteCart(second, [{ productId: mine!.id, quantity: 1 }]);
    expect(kids.discount).toBe(60);
    const elsewhere = await quoteCart(site, [{ productId: shared!.id, quantity: 1 }]);
    expect(elsewhere.discounts.map((d) => d.name)).not.toContain("Kids week");

    await signUpCustomer(a.tenantId, { name: "Kid Parent", email: "parent@kids.test", password: "password-k", siteId: other.id });
    await withTenant(a.tenantId, async (tx) => {
      expect((await listCustomers(tx, other.id)).map((c) => c.email)).toEqual(["parent@kids.test"]);
      expect((await listCustomers(tx, site.siteId)).map((c) => c.email)).not.toContain("parent@kids.test");
      expect((await listCustomers(tx)).map((c) => c.email)).toContain("parent@kids.test");
      expect((await listProducts(tx, { siteId: site.siteId })).map((p) => p.name)).not.toContain("Kids tee");
      expect((await listDiscounts(tx, site.siteId)).map((d) => d.name)).not.toContain("Kids week");
      expect(await listOrders(tx, { siteId: other.id })).toEqual([]);
      expect(await siteCounts(tx)).toMatchObject({ stores: 2, accounts: 2 });
    });
  });
});
