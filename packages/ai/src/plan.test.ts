import { getTemplate } from "@zsite/core";
import { describe, expect, it } from "vitest";
import { type SitePlan, planBrief, planSite } from "./plan";
import type { Provider } from "./providers/types";

const context = { businessName: "Asha Bakes", siteKind: "landing" as const, categories: [], productCount: 0, catalogueSource: null };
const tree = () => getTemplate("landing-launch").build({ businessName: "Asha Bakes" });
const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, requests: 1 };

const plan: SitePlan = {
  summary: "A warm, modern one-page site for a Patna bakery that sells cakes to order.",
  assumptions: ["Customers are local families", "Orders are taken on WhatsApp"],
  pages: [{ path: "/", title: "Home", sections: ["hero — fresh cakes baked every morning", "gallery — six bestsellers", "contact — WhatsApp and map"] }],
  style: { mood: "warm and homely", colors: "cream #fff8ef with cocoa #5b3a29", fonts: "Poppins / DM Sans", motion: "subtle" },
  imagery: "Stock photos of cakes and the counter",
  questions: ["Do you deliver outside Patna?"],
};

describe("plan first", () => {
  it("returns the plan the model submits, and edits nothing", async () => {
    let names: string[] = [];
    const runner: Provider = async ({ tools, model }) => {
      names = tools.map((t) => t.name);
      await tools.find((t) => t.name === "submit_plan")!.run(plan);
      return { finalText: "Plan ready.", model, usage, stopReason: "end_turn", refused: false };
    };
    const r = await planSite({ tree: tree(), prompt: "bakery in patna", context, runner });
    expect(r.plan).toEqual(plan);
    expect(names).toContain("submit_plan");
    // Planning looks; it has no editing tools.
    expect(names).not.toContain("set_theme");
    expect(names).not.toContain("add_section");
  });

  it("asks once more when the model forgets to submit, then gives up with a clear error", async () => {
    let calls = 0;
    const forgetful: Provider = async ({ tools, model }) => {
      calls++;
      if (calls === 2) await tools.find((t) => t.name === "submit_plan")!.run(plan);
      return { finalText: "Here is my plan…", model, usage, stopReason: "end_turn", refused: false };
    };
    expect((await planSite({ tree: tree(), prompt: "bakery", context, runner: forgetful })).usage.requests).toBe(2);

    const never: Provider = async ({ model }) => ({ finalText: "Sure!", model, usage, stopReason: "end_turn", refused: false });
    await expect(planSite({ tree: tree(), prompt: "bakery", context, runner: never })).rejects.toThrow(/did not produce a plan/);
  });

  it("sends a malformed plan back to the model to fix", async () => {
    const runner: Provider = async ({ tools, model }) => {
      const submit = tools.find((t) => t.name === "submit_plan")!;
      await expect(Promise.resolve().then(() => submit.run({ summary: "x" }))).rejects.toThrow(/pages/);
      await submit.run(plan);
      return { finalText: "Plan ready.", model, usage, stopReason: "end_turn", refused: false };
    };
    expect((await planSite({ tree: tree(), prompt: "bakery", context, runner })).plan.pages).toHaveLength(1);
  });

  it("writes the approved plan and the owner's notes for the builder", () => {
    const brief = planBrief(plan, "We deliver across Bihar.");
    expect(brief).toContain("Approved plan");
    expect(brief).toContain('Page / "Home"');
    expect(brief).toContain("  - gallery — six bestsellers");
    expect(brief).toContain("We deliver across Bihar.");
    expect(planBrief(plan)).not.toContain("notes");
  });
});
