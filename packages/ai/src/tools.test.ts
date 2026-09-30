import { getTemplate } from "@zsite/core";
import { describe, expect, it } from "vitest";
import { createSiteTools, outline } from "./tools";

const tree = () => getTemplate("store-classic").build({ businessName: "Demo Mobiles" });

function tool(tools: ReturnType<typeof createSiteTools>["tools"], name: string) {
  const t = tools.find((t) => t.name === name);
  if (!t) throw new Error(name);
  // The tools array is heterogeneous; each run validates its own input.
  return t as unknown as { run: (input: unknown) => Promise<string> };
}

describe("site tools", () => {
  it("apply operations and report new ids", async () => {
    const { tools, state } = createSiteTools(tree());
    const out = JSON.parse(
      await tool(tools, "add_section").run({
        page: "/",
        type: "faq",
        props: { heading: "Delivery questions", items: [{ question: "How fast?", answer: "Two days in Patna." }] },
        after: "shop",
      }),
    );
    expect(out.ok).toBe(true);
    expect(out.section).toMatch(/^s_/);
    await tool(tools, "set_theme").run({ colors: { primary: "#0f766e" } });
    expect(state.operations).toHaveLength(2);
    expect(state.tree.theme.colors.primary).toBe("#0f766e");
  });

  it("throw readable errors and leave the tree alone", async () => {
    const { tools, state } = createSiteTools(tree());
    const before = JSON.stringify(state.tree);
    await expect(async () => tool(tools, "update_section").run({ section: "shop", props: { limit: 500 } })).rejects.toThrow(/limit/);
    await expect(async () => tool(tools, "remove_page").run({ page: "/" })).rejects.toThrow(/home page/);
    expect(JSON.stringify(state.tree)).toBe(before);
    expect(state.operations).toHaveLength(0);
  });

  it("outline names pages and sections", () => {
    const o = outline(tree());
    expect(o).toContain("path=/ ");
    expect(o).toContain("shop (productGrid)");
  });
});

describe("brand locks, data proposals and optional tools", () => {
  it("keeps colours the owner fixed and says so", async () => {
    const { tools, state } = createSiteTools(tree(), { lockedTheme: ["colors.primary", "motion"] });
    const out = JSON.parse(await tool(tools, "set_theme").run({ colors: { primary: "#000000", accent: "#ff0000" }, motion: "lively" }));
    expect(out.kept).toEqual(["colors.primary", "motion"]);
    expect(state.tree.theme.colors.primary).not.toBe("#000000");
    expect(state.tree.theme.colors.accent).toBe("#ff0000");
    expect(state.tree.theme.motion).toBeUndefined();
  });

  it("applies additions and empty-field fills, and holds changes to existing data as proposals", async () => {
    const data = { projects: [{ id: "p1", title: "One", summary: "" }], profile: [{ name: "Asha" }] };
    const { tools, state } = createSiteTools(tree(), {}, data);
    await tool(tools, "add_entry").run({ collection: "projects", item: { title: "Two" } });
    await tool(tools, "update_entry").run({ collection: "profile", fields: { headline: "Designer" } }); // empty → applies
    const held = JSON.parse(await tool(tools, "update_entry").run({ collection: "profile", fields: { name: "Someone else" } }));
    expect(held.proposed).toBe(true);
    await tool(tools, "remove_entry").run({ collection: "projects", id: "p1" });
    expect(state.data.projects!.map((p) => p.title)).toEqual(["One", "Two"]);
    expect(state.data.profile![0]).toMatchObject({ name: "Asha", headline: "Designer" });
    expect(state.proposals.map((p) => p.op.op)).toEqual(["updateItem", "removeItem"]);
    expect(state.proposals[1]!.description).toMatch(/Remove Projects “One”/);
  });

  it("applies overwrites directly in collections the owner allowed", async () => {
    const { tools, state } = createSiteTools(tree(), { allowOverwrite: ["projects"] }, { projects: [{ id: "p1", title: "One" }] });
    await tool(tools, "update_entry").run({ collection: "projects", id: "p1", fields: { title: "Renamed" } });
    expect(state.proposals).toHaveLength(0);
    expect(state.data.projects![0]!.title).toBe("Renamed");
  });

  it("offers generate_image and fetch_reference only when the platform provides them, within limits", async () => {
    expect(createSiteTools(tree()).tools.map((t) => t.name)).not.toContain("generate_image");
    const prompts: string[] = [];
    const { tools, state } = createSiteTools(tree(), {
      generateImage: async (r) => (prompts.push(r.prompt), { url: "https://img.test/1.png", width: 1408, height: 768 }),
      fetchReference: async (url) => ({ url, title: "Ref", description: "", headings: [], navigation: [], sections: [], colors: ["#112233"], fonts: [], text: "" }),
      maxImages: 1,
      imagePalette: ["#123456"],
    });
    const img = JSON.parse(await tool(tools, "generate_image").run({ prompt: "A bright shop counter with phone cases", aspect: "wide" }));
    expect(img.url).toBe("https://img.test/1.png");
    expect(prompts[0]).toMatch(/Colour palette: #123456/);
    await expect(tool(tools, "generate_image").run({ prompt: "Another picture of the shop front" })).rejects.toThrow(/limit of 1/);
    expect(state.images).toBe(1);
    const ref = JSON.parse(await tool(tools, "fetch_reference").run({ url: "https://example.com" }));
    expect(ref.colors).toEqual(["#112233"]);
  });
});

describe("when picture generation is refused", () => {
  it("does not count the failure, refuses retries, and keeps the rest of the edit possible", async () => {
    let calls = 0;
    const { tools, state } = createSiteTools(tree(), {
      generateImage: async () => {
        calls++;
        throw new Error("AWS has not allowed this account to use amazon.nova-canvas-v1:0 in us-east-1 yet.");
      },
      maxImages: 4,
    });
    await expect(tool(tools, "generate_image").run({ prompt: "A bright shop counter with phone cases" })).rejects.toThrow(/Do not retry/);
    await expect(tool(tools, "generate_image").run({ prompt: "Another picture of the shop front" })).rejects.toThrow(/unavailable/);
    expect(calls).toBe(1);
    expect(state.images).toBe(0);
    expect(state.imageError).toMatch(/nova-canvas/);
    await tool(tools, "set_theme").run({ colors: { primary: "#0f766e" } });
    expect(state.operations).toHaveLength(1);
  });

  it("strips Nova's reasoning tags from what reaches the version history", async () => {
    const { stripReasoning } = await import("./providers/bedrock");
    expect(stripReasoning("<thinking>plan</thinking> Added an FAQ.")).toBe("Added an FAQ.");
    expect(stripReasoning("The tool results indicate a failure. </thinking>")).toBe("");
    expect(stripReasoning("Done. <thinking>unfinished")).toBe("Done.");
  });
});

describe("collections are for portfolios", () => {
  it("offers no data tools and refuses collection sections when the site does not use them", async () => {
    const { tools } = createSiteTools(tree(), { dataTools: false });
    expect(tools.map((t) => t.name)).not.toContain("add_entry");
    expect(() => tool(tools, "add_section").run({ page: "/", type: "collection", props: { collection: "projects" } })).toThrow(/portfolio sites/);
    expect(createSiteTools(tree()).tools.map((t) => t.name)).toContain("add_entry");
  });
});

describe("an answer that claims changes it never made", () => {
  it("is asked once more, and the second attempt's edits are kept with both attempts' tokens", async () => {
    const { editSite } = await import("./agent");
    let call = 0;
    const runner = (async ({ tools }: { tools: { name: string; run: (i: unknown) => unknown }[] }) => {
      call++;
      if (call === 2) await tools.find((t) => t.name === "set_theme")!.run({ colors: { primary: "#0f766e" } });
      return { finalText: call === 1 ? "I have updated the hero." : "Changed the primary colour.", model: "m", usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, requests: 1 }, stopReason: "end_turn", refused: false };
    }) as never;
    const r = await editSite({ tree: tree(), prompt: "Teal please", context: { businessName: "X", siteKind: "store", categories: [], productCount: 0, catalogueSource: null }, runner });
    expect(call).toBe(2);
    expect(r.tree.theme.colors.primary).toBe("#0f766e");
    expect(r.usage).toMatchObject({ input_tokens: 20, requests: 2 });
  });
});

describe("commerce tool", () => {
  it("is offered to stores only, and changes the cart and checkout settings", async () => {
    expect(createSiteTools(tree()).tools.map((t) => t.name)).not.toContain("set_commerce");
    const { tools, state } = createSiteTools(tree(), { commerceTools: true });
    await tools.find((t) => t.name === "set_commerce")!.run({ cart: { style: "drawer", icon: "basket" }, account: { placement: "footer" } });
    expect(state.tree.commerce).toMatchObject({ cart: { style: "drawer", icon: "basket" }, account: { placement: "footer", show: true } });
  });
});

describe("design tools", () => {
  it("styles sections, and turns an unknown icon name into a correctable error with suggestions", async () => {
    const { tools, state } = createSiteTools(tree());
    const hero = state.tree.pages[0]!.sections[0]!.id;
    await tools.find((t) => t.name === "style_section")!.run({ section: hero, style: { spacing: "roomy" } });
    expect(state.tree.pages[0]!.sections[0]!.style).toEqual({ spacing: "roomy" });
    await expect(
      Promise.resolve().then(() =>
        tools.find((t) => t.name === "add_section")!.run({ page: "/", type: "features", props: { heading: "Why us", items: [{ title: "Fast", body: "x", icon: "delivery-van" }] } }),
      ),
    ).rejects.toThrow(/No icon called "delivery-van"/);
    const out = JSON.parse(
      await tools.find((t) => t.name === "add_section")!.run({ page: "/", type: "marquee", props: { items: ["A", "B"], icon: "truck" }, style: { background: "dark" } }),
    );
    expect(state.tree.pages[0]!.sections.find((s) => s.id === out.section)?.style).toEqual({ background: "dark" });
  });
});

describe("forms, tables and plain text", () => {
  const contact = {
    heading: "Write to us",
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "email", label: "Email", type: "email", required: true },
    ],
    destination: { kind: "table", table: "enquiries" },
  };

  it("creates a table, then a form that fills it, and records both for the version", async () => {
    const { tools, state } = createSiteTools(tree(), { tables: [] });
    await expect(async () => tool(tools, "add_section").run({ page: "/", type: "form", props: contact })).rejects.toThrow(/create_table/);
    await tool(tools, "create_table").run({
      key: "enquiries",
      name: "Enquiries",
      columns: [{ key: "name", label: "Name", type: "text" }, { key: "email", label: "Email", type: "email" }],
    });
    const out = JSON.parse(await tool(tools, "add_section").run({ page: "/", type: "form", props: contact }));
    expect(out.ok).toBe(true);
    expect(state.tableOps).toEqual([expect.objectContaining({ op: "create", key: "enquiries", notify: true })]);
    const listed = JSON.parse(await tool(tools, "list_tables").run({}));
    expect(listed.map((t: { key: string }) => t.key)).toEqual(["enquiries"]);
  });

  it("refuses a form field its table has no column for, and a table that already exists", async () => {
    const tables = [{ key: "enquiries", name: "Enquiries", columns: [{ key: "name", label: "Name", type: "text" as const }], rows: 3 }];
    const { tools } = createSiteTools(tree(), { tables });
    await expect(async () => tool(tools, "add_section").run({ page: "/", type: "form", props: contact })).rejects.toThrow(/no column for email/);
    await expect(async () => tool(tools, "create_table").run({ key: "enquiries", name: "x", columns: [{ key: "a", label: "A" }] })).rejects.toThrow(/already exists/);
  });

  it("never deletes a table itself: the deletion is held for the owner", async () => {
    const tables = [{ key: "old", name: "Old", columns: [{ key: "a", label: "A", type: "text" as const }], rows: 12 }];
    const { tools, state } = createSiteTools(tree(), { tables });
    const out = JSON.parse(await tool(tools, "delete_table").run({ key: "old", reason: "The form was removed" }));
    expect(out.proposed).toBe(true);
    expect(state.tableDeletes).toEqual([{ key: "old", reason: "The form was removed" }]);
    expect(state.tableOps).toHaveLength(0);
    await expect(async () => tool(tools, "delete_table").run({ key: "missing", reason: "x" })).rejects.toThrow(/no table/);
  });

  it("stores answers only where tables exist, and lets any site send a form to a URL", async () => {
    const { tools } = createSiteTools(tree());
    expect(tools.map((t) => t.name)).not.toContain("create_table");
    await expect(async () => tool(tools, "add_section").run({ page: "/", type: "form", props: contact })).rejects.toThrow(/not available/);
    const out = JSON.parse(
      await tool(tools, "add_section").run({ page: "/", type: "form", props: { ...contact, destination: { kind: "url", url: "https://example.com/signup" } } }),
    );
    expect(out.ok).toBe(true);
  });

  it("turns HTML in text back to the model, and takes a table block instead", async () => {
    const { tools, state } = createSiteTools(tree());
    await expect(async () =>
      tool(tools, "add_section").run({ page: "/", type: "richText", props: { heading: "Prices", body: "<table><tr><td>Cake</td></tr></table>" } }),
    ).rejects.toThrow(/contains HTML/);
    await tool(tools, "add_section").run({
      page: "/",
      type: "table",
      props: { heading: "Prices", columns: ["Cake", "Price"], rows: [["Chocolate", "₹600"], ["Mango", "₹650"]] },
    });
    await tool(tools, "add_section").run({ page: "/", type: "richText", props: { body: "Prices go up when 3 < 5 — and that is fine.\n- Eggless too" } });
    expect(state.operations).toHaveLength(2);
  });

  it("takes a single choice as pills, with an option chosen already", async () => {
    const { tools, state } = createSiteTools(tree());
    const pills = { name: "kind", label: "Type", type: "pills", options: ["Website", "Store", "Portfolio"], value: "Website" };
    await tool(tools, "add_section").run({
      page: "/",
      type: "form",
      props: { heading: "Describe it", fields: [{ name: "prompt", label: "Describe your website", type: "textarea", required: true }, pills], destination: { kind: "url", url: "https://studio.zuuvy.site/signup" } },
    });
    const form = state.tree.pages[0]!.sections.find((s) => s.type === "form")!;
    expect((form.props as { fields: unknown[] }).fields[1]).toMatchObject({ type: "pills", value: "Website", options: ["Website", "Store", "Portfolio"] });
  });

  it("offers save_image only with a way to store it, and passes through what it is given", async () => {
    expect(createSiteTools(tree()).tools.map((t) => t.name)).not.toContain("save_image");
    const seen: unknown[] = [];
    const { tools } = createSiteTools(tree(), {
      importImage: async (i) => {
        seen.push(i);
        return { url: "https://cdn.test/a.png" };
      },
    });
    await expect(async () => tool(tools, "save_image").run({ alt: "x" })).rejects.toThrow(/download url or the svg/);
    expect(JSON.parse(await tool(tools, "save_image").run({ url: "https://img.icons8.com/x.png", alt: "A cake" })).url).toBe("https://cdn.test/a.png");
    expect(seen).toEqual([{ url: "https://img.icons8.com/x.png", svg: undefined, alt: "A cake" }]);
  });
});

describe("cart, account and their pages", () => {
  it("lets a store style its cart and account and write its own pages", async () => {
    const { tools, state } = createSiteTools(tree(), { commerceTools: "store" });
    await tool(tools, "set_commerce").run({
      cart: { display: "pill", label: "Basket" },
      account: { display: "label" },
      pages: { frame: "tinted", auth: { layout: "centered", perks: ["Reorder in one tap"] }, cart: { empty: "Nothing here yet" }, thanks: { heading: "Shukriya, {name}!" } },
    });
    const c = state.tree.commerce!;
    expect(c.cart).toMatchObject({ display: "pill", label: "Basket", style: "drawer" });
    expect(c.account.display).toBe("label");
    expect(c.pages).toMatchObject({ frame: "tinted", auth: { layout: "centered", perks: ["Reorder in one tap"] }, cart: { empty: "Nothing here yet" } });
    // A later change keeps what it does not mention.
    await tool(tools, "set_commerce").run({ pages: { auth: { heading: "Welcome back" } } });
    expect(state.tree.commerce!.pages.auth).toMatchObject({ layout: "centered", heading: "Welcome back", perks: ["Reorder in one tap"] });
  });

  it("gives a site with accounts but nothing to sell no cart", async () => {
    const { tools, state } = createSiteTools(tree(), { commerceTools: "accounts" });
    await expect(async () => tool(tools, "set_commerce").run({ cart: { display: "button" } })).rejects.toThrow(/no cart/);
    await tool(tools, "set_commerce").run({ account: { label: "Members", display: "button" }, pages: { auth: { layout: "image", image: "https://images.unsplash.com/x" } } });
    expect(state.tree.commerce!.account).toMatchObject({ label: "Members", display: "button" });
    expect(createSiteTools(tree()).tools.map((t) => t.name)).not.toContain("set_commerce");
  });
});
