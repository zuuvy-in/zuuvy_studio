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
