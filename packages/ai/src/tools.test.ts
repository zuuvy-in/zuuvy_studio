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
