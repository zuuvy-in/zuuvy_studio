import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConnectorError } from "../types";
import { zuuvy } from "./connector";
import { type MockZuuvy, startMockZuuvy } from "./mock-server";
import { sign, verify } from "./signature";

let mock: MockZuuvy;
let conn: ReturnType<typeof zuuvy.parse>;

beforeAll(async () => {
  process.env.ZSITE_ALLOW_CUSTOM_ZUUVY_URL = "1";
  mock = await startMockZuuvy();
  conn = zuuvy.parse({ tenant: mock.tenant, apiKey: mock.apiKey, baseUrl: mock.url });
});
afterAll(() => mock.close());

describe("signatures", () => {
  const secret = "s".repeat(32);
  it("round-trips", () => {
    expect(verify(secret, sign(secret, "{}"), "{}")).toEqual({ ok: true });
  });
  it("refuses a tampered body, a wrong secret and an old timestamp", () => {
    const header = sign(secret, '{"a":1}');
    expect(verify(secret, header, '{"a":2}').ok).toBe(false);
    expect(verify("x".repeat(32), header, '{"a":1}').ok).toBe(false);
    const old = sign(secret, "{}", new Date(Date.now() - 10 * 60_000));
    expect(verify(secret, old, "{}")).toEqual({ ok: false, reason: "signature timestamp outside tolerance" });
    expect(verify(secret, undefined, "{}").ok).toBe(false);
    expect(verify(secret, "t=1,v1=zz", "{}").ok).toBe(false);
  });
});

describe("zuuvy connector against the mock", () => {
  it("refuses an API URL override unless switched on", () => {
    delete process.env.ZSITE_ALLOW_CUSTOM_ZUUVY_URL;
    expect(() => zuuvy.parse({ tenant: "demo", apiKey: "zk_test_demo", baseUrl: "http://169.254.169.254" })).toThrow(ConnectorError);
    process.env.ZSITE_ALLOW_CUSTOM_ZUUVY_URL = "1";
  });

  it("tests the connection and names the organisation", async () => {
    const info = await zuuvy.test(conn);
    expect(info.headline).toBe("Demo Mobiles");
    expect(info.details["Price tier"]).toBe("Retail");
  });

  it("says plainly when the key is wrong", async () => {
    const bad = { ...conn, secrets: { apiKey: "zk_wrong_key" } };
    await expect(zuuvy.test(bad)).rejects.toMatchObject({ retryable: false, status: 401 });
  });

  it("pages through the catalogue", async () => {
    const items = [];
    let cursor: string | null = null;
    do {
      const page = await zuuvy.fetchCatalog!(conn, { since: null, cursor });
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    expect(items).toHaveLength(10);
    expect(items[0]).toMatchObject({ externalId: "1001", listed: true, price: 899 });
  });

  it("pushes an order idempotently", async () => {
    const order = {
      requestId: "ord_1",
      reference: "WEB-1",
      customer: { name: "Asha", phone: "9876543210", address: "Patna" },
      lines: [{ externalProductId: "1001", name: "Charger", quantity: 2, unitPrice: 899 }],
      payment: { method: "cod" as const, status: "unpaid" as const },
      subtotal: 1798,
      total: 1798,
    };
    const first = await zuuvy.pushOrder!(conn, order);
    const again = await zuuvy.pushOrder!(conn, order);
    expect(first).toEqual(again);
    expect(first.status).toBe("pending");
    expect(mock.state.orders).toHaveLength(1);
  });

  it("reserves stock only when a COD order is accepted", async () => {
    const before = mock.state.products.find((p) => p.id === "1001")!.stock;
    const orderId = mock.state.orders[0]!.id;
    await mock.setStatus(orderId, "accepted");
    expect(mock.state.products.find((p) => p.id === "1001")!.stock).toBe(before! - 2);
    await mock.setStatus(orderId, "cancelled");
    expect(mock.state.products.find((p) => p.id === "1001")!.stock).toBe(before);
  });

  it("parses a signed webhook into a platform event", () => {
    const secret = "w".repeat(32);
    const body = JSON.stringify({
      id: "d1",
      event: "order.status_changed",
      occurred_at: new Date().toISOString(),
      data: { order_id: 5001, request_id: "ord_1", status: "out_for_delivery" },
    });
    const event = zuuvy.parseWebhook!(secret, { "x-zuuvy-signature": sign(secret, body) }, body);
    expect(event).toEqual({
      kind: "order.status",
      deliveryId: "d1",
      requestId: "ord_1",
      externalOrderId: "5001",
      status: "shipped",
      externalStatus: "out_for_delivery",
    });
    expect(() => zuuvy.parseWebhook!(secret, { "x-zuuvy-signature": "t=1,v1=00" }, body)).toThrow(/refused/);
  });

  it("accepts unknown events without failing", () => {
    const secret = "w".repeat(32);
    const body = JSON.stringify({ id: "d2", event: "invoice.created", occurred_at: "", data: {} });
    expect(zuuvy.parseWebhook!(secret, { "x-zuuvy-signature": sign(secret, body) }, body)).toEqual({
      kind: "ignored",
      deliveryId: "d2",
      topic: "invoice.created",
    });
  });
});
