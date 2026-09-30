/**
 * Forms and site tables against a real database: the AI's table changes land
 * with its version, a deletion waits for the owner, and a visitor's answers
 * are checked against the published form — never the browser.
 */
import { type EditResult } from "@zsite/ai";
import { type SiteTree, applyOps } from "@zsite/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  HANDLERS,
  createSite,
  createStarterSite,
  isLandingStart,
  landingPrompt,
  landingQuery,
  parseLanding,

  deleteRows,
  applyTableOps,
  deleteSiteTable,
  getSiteTable,
  importRows,
  parseCsv,
  queryRows,
  drainOutbox,
  emailVerified,
  getSite,
  generateVersion,
  latestVersion,
  listRows,
  listSiteTables,
  publishVersion,
  rowsToCsv,
  safeSvg,
  sendEmailVerification,
  sentForTests,
  setAlerts,
  signup,
  submitForm,
  verifyEmail,
  withTenant,
} from "./index";
import { createTestDatabase } from "./testing";

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let a: { userId: string; tenantId: string };
let b: { userId: string; tenantId: string };
let siteId: string;
let formId = "";

const FORM = {
  heading: "Book a table",
  fields: [
    { name: "name", label: "Name", type: "text", required: true, width: "full" },
    { name: "email", label: "Email", type: "email", required: true, width: "half" },
    { name: "guests", label: "Guests", type: "number", required: false, width: "half" },
    { name: "time", label: "Time", type: "select", options: ["Lunch", "Dinner"], required: true, width: "full" },
    { name: "terms", label: "I agree", type: "checkbox", required: true, width: "full" },
  ],
  submitLabel: "Book",
  successMessage: "Thanks — see you soon.",
  destination: { kind: "table", table: "bookings" },
  layout: "card",
};

beforeAll(async () => {
  db = await createTestDatabase();
  a = await signup({ businessName: "Asha Cafe", name: "Asha", email: "asha@cafe.test", password: "password-a", emailVerified: true });
  b = await signup({ businessName: "Other Cafe", name: "Bo", email: "bo@other.test", password: "password-b", emailVerified: true });
  const site = await withTenant(a.tenantId, (tx) =>
    createSite(tx, { name: "Asha", subdomain: "asha-cafe", templateId: "landing-launch", templateInput: { businessName: "Asha Cafe" }, userId: a.userId }),
  );
  siteId = site.id;
});
afterAll(async () => {
  await db?.drop();
});

function fakeEditor(result: Partial<EditResult>, edit: (tree: SiteTree) => SiteTree = (t) => t) {
  return (async (opts: { tree: SiteTree; data?: Record<string, unknown> }) =>
    ({
      tree: edit(opts.tree),
      operations: [{ op: "setMeta", title: "x" }],
      summary: "done",
      model: "fake",
      provider: "bedrock",
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, requests: 1 },
      images: 0,
      data: opts.data ?? {},
      dataOperations: [],
      proposals: [],
      stopReason: "end_turn",
      ...result,
    }) as EditResult) as never;
}

const answers = (v: Record<string, string>) => (name: string) => v[name] ?? null;

describe("site tables", () => {
  it("are created with the AI's version, and a deletion is only proposed", async () => {
    const base = await withTenant(a.tenantId, (tx) => latestVersion(tx, siteId));
    const withForm = (tree: SiteTree) => {
      const next = applyOps(tree, [{ op: "addSection", page: "/", type: "form", props: FORM }]);
      formId = next.pages[0]!.sections.find((s) => s.type === "form")!.id;
      return next;
    };
    const v = await generateVersion(
      a.tenantId,
      { siteId, baseVersionId: base.id, prompt: "Add a booking form", userId: a.userId },
      {
        editor: fakeEditor(
          {
            tableOps: [
              {
                op: "create",
                key: "bookings",
                name: "Bookings",
                columns: FORM.fields.map((f) => ({ key: f.name, label: f.label, type: f.type as never })),
              },
              { op: "create", key: "old_list", name: "Old list", columns: [{ key: "a", label: "A", type: "text" }] },
            ],
            tableDeletes: [{ key: "old_list", reason: "No form uses it" }],
          },
          withForm,
        ),
      },
    );
    const tables = await withTenant(a.tenantId, (tx) => listSiteTables(tx, siteId));
    expect(tables.map((t) => [t.key, t.rows, t.notify])).toEqual([["bookings", 0, true], ["old_list", 0, true]]);
    const saved = await withTenant(a.tenantId, (tx) => latestVersion(tx, siteId));
    expect(saved.number).toBe(v.number);
    expect((saved.ai_meta as { tableDeletes: unknown[] }).tableDeletes).toEqual([{ key: "old_list", reason: "No form uses it" }]);
    await withTenant(a.tenantId, (tx) => deleteSiteTable(tx, siteId, "old_list"));
    await withTenant(a.tenantId, (tx) => publishVersion(tx, siteId, saved.id, a.userId));
  });

  it("are invisible to another business", async () => {
    expect(await withTenant(b.tenantId, (tx) => listSiteTables(tx, siteId))).toEqual([]);
  });
});

describe("form submissions", () => {
  const r = () => ({ tenantId: a.tenantId, siteId });
  const good = { name: "Ravi", email: "Ravi@Example.com", guests: "4", time: "Dinner", terms: "on" };

  it("stores a checked answer and emails the business", async () => {
    await withTenant(a.tenantId, (tx) => setAlerts(tx, { orders: true, emails: ["owner@cafe.test"] }));
    sentForTests.length = 0;
    const out = await submitForm(r(), { section: formId, page: "/", get: answers(good), startedAt: Date.now() - 10_000 });
    expect(out.message).toBe("Thanks — see you soon.");
    await drainOutbox(HANDLERS);
    expect(sentForTests.map((e) => e.subject)).toEqual(["New Bookings on Asha"]);
    expect(sentForTests[0]!.text).toContain("Guests: 4");
    const table = (await withTenant(a.tenantId, (tx) => listSiteTables(tx, siteId)))[0]!;
    const rows = await withTenant(a.tenantId, (tx) => listRows(tx, table.id));
    expect(rows[0]!.data).toEqual({ name: "Ravi", email: "ravi@example.com", guests: 4, time: "Dinner", terms: true });
  });

  it("refuses missing, malformed and made-up answers in words", async () => {
    const send = (v: Record<string, string>) => submitForm(r(), { section: formId, page: "/", get: answers(v) });
    await expect(send({ ...good, name: "" })).rejects.toThrow(/fill in “Name”/);
    await expect(send({ ...good, email: "nope" })).rejects.toThrow(/email address/);
    await expect(send({ ...good, guests: "many" })).rejects.toThrow(/needs a number/);
    await expect(send({ ...good, time: "Breakfast" })).rejects.toThrow(/Choose one/);
    await expect(send({ ...good, terms: "" })).rejects.toThrow(/tick “I agree”/);
    await expect(submitForm(r(), { section: "hero", page: "/", get: answers(good) })).rejects.toThrow(/no longer on the site/);
  });

  it("quietly drops bots: a filled hidden field, or an answer faster than a person reads", async () => {
    const table = (await withTenant(a.tenantId, (tx) => listSiteTables(tx, siteId)))[0]!;
    const before = table.rows!;
    await submitForm(r(), { section: formId, page: "/", get: answers({ ...good, _website: "spam.example" }) });
    await submitForm(r(), { section: formId, page: "/", get: answers(good), startedAt: Date.now() - 200 });
    expect((await withTenant(a.tenantId, (tx) => listSiteTables(tx, siteId)))[0]!.rows).toBe(before);
  });

  it("exports rows as CSV that a spreadsheet will not execute, and deletes rows", async () => {
    await submitForm(r(), { section: formId, page: "/", get: answers({ ...good, name: "=HYPERLINK(\"x\")" }) });
    const table = (await withTenant(a.tenantId, (tx) => listSiteTables(tx, siteId)))[0]!;
    const rows = await withTenant(a.tenantId, (tx) => listRows(tx, table.id));
    const csv = rowsToCsv(table, rows);
    expect(csv.split("\r\n")[0]).toBe('"Received","Name","Email","Guests","Time","I agree","Page"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    await withTenant(a.tenantId, (tx) => deleteRows(tx, table.id, rows.map((x) => x.id)));
    expect(await withTenant(a.tenantId, (tx) => listRows(tx, table.id))).toEqual([]);
  });

  it("stops accepting answers once the owner deletes the table", async () => {
    await withTenant(a.tenantId, (tx) => deleteSiteTable(tx, siteId, "bookings"));
    await expect(submitForm(r(), { section: formId, page: "/", get: answers(good) })).rejects.toThrow(/not accepting answers/);
  });
});

describe("imported pictures", () => {
  it("accepts plain SVG and refuses anything that could run", () => {
    expect(safeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10z" fill="url(#g)"/></svg>')).toBeTruthy();
    for (const bad of [
      "<svg><script>alert(1)</script></svg>",
      '<svg onload="alert(1)"></svg>',
      '<svg><a href="javascript:alert(1)"><path/></a></svg>',
      '<svg><image href="https://evil.test/x.png"/></svg>',
      "<svg><foreignObject><div/></foreignObject></svg>",
      '<svg><style>@import url("https://evil.test/x.css");</style></svg>',
    ]) {
      expect(() => safeSvg(bad)).toThrow();
    }
  });
});



describe("email verification", () => {
  it("holds a new account's sites back from going live until the link is used", async () => {
    const c = await signup({ businessName: "New Bakery", name: "Nia", email: "nia@bakery.test", password: "password-n" });
    const site = await withTenant(c.tenantId, (tx) =>
      createSite(tx, { name: "Default", subdomain: "nia-bakery", templateId: "landing-launch", templateInput: { businessName: "New Bakery" }, userId: c.userId }),
    );
    expect(site.published_number).toBeNull();
    const v = await withTenant(c.tenantId, (tx) => latestVersion(tx, site.id));
    await expect(withTenant(c.tenantId, (tx) => publishVersion(tx, site.id, v.id, c.userId))).rejects.toThrow(/Confirm your email/);

    const link = async () => {
      sentForTests.length = 0;
      expect(await sendEmailVerification(c.tenantId, c.userId)).toEqual({ sent: true });
      await drainOutbox(HANDLERS);
      return /verify-email\?token=([\w-]+)/.exec(sentForTests.find((e) => e.to === "nia@bakery.test")!.text)![1]!;
    };
    const links = [await link(), await link()]; // a resend replaces the first link
    expect(await verifyEmail(links[0]!)).toMatchObject({ error: expect.stringMatching(/already been used|newer one/) });
    expect(await verifyEmail("short")).toMatchObject({ error: expect.any(String) });
    expect(await verifyEmail(links[1]!)).toEqual({ userId: c.userId });
    expect(await emailVerified(c.userId)).toBe(true);
    expect(await sendEmailVerification(c.tenantId, c.userId)).toEqual({ sent: false });

    await withTenant(c.tenantId, (tx) => publishVersion(tx, site.id, v.id, c.userId));
    expect((await withTenant(c.tenantId, (tx) => getSite(tx, site.id))).published_number).toBe(1);
  });
});

describe("starting from the landing page", () => {
  it("reads only what a form can honestly carry", () => {
    const q = new URLSearchParams(
      "business=Asha%20Bakes&name=Asha&email=ASHA@x.in&phone=98765%2043210&kind=shop&site=Cakes&tagline=Warm%20cakes&prompt=A%20bright%20site&subdomain=Asha%20Bakes!",
    );
    const p = parseLanding((k) => q.get(k));
    expect(p).toEqual({
      business: "Asha Bakes",
      name: "Asha",
      email: "asha@x.in",
      phone: "98765 43210",
      kind: "store",
      site: "Cakes",
      tagline: "Warm cakes",
      prompt: "A bright site",
      subdomain: "asha-bakes",
    });
    expect(parseLanding((k) => ({ email: "not-an-email", kind: "spaceship", phone: "call me" })[k] ?? null)).toEqual({});
    expect(isLandingStart({ business: "x" })).toBe(false);
    expect(landingQuery({ kind: "store", prompt: "a b" })).toBe("?kind=store&prompt=a+b");
    expect(landingPrompt({ kind: "portfolio", tagline: "Wedding photos" }, "Ravi Studio")).toBe("A portfolio site for Ravi Studio — Wedding photos");
  });

  it("creates the site they asked for, on a free address, unpublished until the email is confirmed", async () => {
    const c = await signup({ businessName: "Ravi Mobiles", name: "Ravi", email: "ravi@mobiles.test", password: "password-r" });
    const make = () =>
      withTenant(c.tenantId, (tx) =>
        createStarterSite(tx, { params: { kind: "store", tagline: "Phones", subdomain: "ravi-mobiles" }, businessName: "Ravi Mobiles", email: "ravi@mobiles.test", userId: c.userId }),
      );
    const first = await make();
    expect(first).toMatchObject({ name: "Default", kind: "store", subdomain: "ravi-mobiles", published_number: null });
    const second = await make();
    expect(second.subdomain).toMatch(/^ravi-mobiles-[0-9a-f]{4}$/);
  });
});

describe("the Data grid", () => {
  const leads = async () => {
    await withTenant(a.tenantId, (tx) =>
      applyTableOps(tx, siteId, [
        {
          op: "create",
          key: "leads",
          name: "Leads",
          columns: [
            { key: "name", label: "Name", type: "text" },
            { key: "email", label: "Email", type: "email" },
            { key: "budget", label: "Budget", type: "number" },
            { key: "plan", label: "Plan", type: "select" },
            { key: "vip", label: "VIP", type: "checkbox" },
          ],
        },
      ]),
    );
    const t = (await withTenant(a.tenantId, (tx) => listSiteTables(tx, siteId))).find((t) => t.key === "leads")!;
    return withTenant(a.tenantId, (tx) => getSiteTable(tx, siteId, t.id));
  };

  it("reads CSV the way spreadsheets write it", () => {
    expect(parseCsv('\uFEFFName,Note\r\n"Ravi, Jr","said ""hi""\nthen left"\r\n\r\nAsha,\n')).toEqual([
      ["Name", "Note"],
      ["Ravi, Jr", 'said "hi"\nthen left'],
      ["Asha", ""],
    ]);
  });

  it("appends, then overwrites or skips duplicates, then replaces — and searches, filters and sorts", async () => {
    const table = await leads();
    const imp = (csv: string, mode: "append" | "replace" | "update" | "skip", matchOn?: string[]) =>
      withTenant(a.tenantId, (tx) => importRows(tx, table, csv, { mode, matchOn }));

    const first = await imp("Email,Name,Budget,Plan,VIP,Ignored\nravi@x.in,Ravi,5000,Gold,yes,z\nasha@x.in,Asha,900,Basic,no,z\nbad,Bad,1,Basic,no,z", "append");
    expect(first).toMatchObject({ added: 2, skipped: [{ line: 4, reason: expect.stringMatching(/email/) }] });

    const upd = await imp("email,budget\nRAVI@x.in,7000\nnew@x.in,100\nnew@x.in,200", "update");
    expect(upd).toMatchObject({ added: 1, updated: 1, duplicates: 2 });
    const skip = await imp("email,name\nasha@x.in,Changed\nlata@x.in,Lata", "skip");
    expect(skip).toMatchObject({ added: 1, updated: 0, duplicates: 1 });
    await expect(imp("name\nNo email", "skip")).rejects.toThrow(/needs a Email column/);

    const q = (query: Parameters<typeof queryRows>[2]) => withTenant(a.tenantId, (tx) => queryRows(tx, table, query));
    expect((await q({})).total).toBe(4);
    const ravi = (await q({ q: "ravi" })).rows;
    expect(ravi.map((r) => r.data)).toEqual([{ name: "Ravi", email: "ravi@x.in", budget: 7000, plan: "Gold", vip: true }]);
    expect((await q({ filters: { vip: "Yes" } })).total).toBe(1);
    expect((await q({ filters: { plan: "Basic" } })).rows.map((r) => r.data.name)).toEqual(["Asha"]);
    expect((await q({ filters: { name: "100%" } })).total).toBe(0);
    expect((await q({ sort: "budget", dir: "desc" })).rows.map((r) => r.data.budget ?? null)).toEqual([7000, 900, 200, null]);
    const paged = await q({ perPage: 3, page: 2 });
    expect(paged).toMatchObject({ total: 4, page: 2, pages: 2 });
    expect(paged.rows).toHaveLength(1);

    const replaced = await imp("Name,Email\nOnly,only@x.in", "replace");
    expect(replaced).toMatchObject({ removed: 4, added: 1 });
    expect((await q({})).total).toBe(1);
    // A file it cannot use never empties the table.
    await expect(imp("Nothing,Useful\n1,2", "replace")).rejects.toThrow(/None of the file's columns/);
    expect((await imp("Email\nnot-an-email", "replace")).removed).toBe(0);
    expect((await q({})).total).toBe(1);
  });
});
