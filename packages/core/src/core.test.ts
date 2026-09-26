import { describe, expect, it } from "vitest";
import {
  OpError,
  TEMPLATES,
  applyOps,
  diffTrees,
  getTemplate,
  parseHost,
  parseTree,
  subdomainProblem,
  summarise,
} from "./index";

const base = () => getTemplate("store-classic").build({ businessName: "Pooja Communications" });

describe("templates", () => {
  it("every template builds a valid tree", () => {
    for (const t of TEMPLATES) {
      const tree = t.build({ businessName: "Acme", email: "hi@acme.in", phone: "9876543210" });
      expect(() => parseTree(tree)).not.toThrow();
      expect(tree.pages.some((p) => p.path === "/")).toBe(true);
    }
  });
});

describe("tree validation", () => {
  it("refuses script links", () => {
    const tree = base();
    tree.nav.links.push({ label: "x", href: "javascript:alert(1)" });
    expect(() => parseTree(tree)).toThrow(/link/);
  });

  it("refuses non-https images", () => {
    expect(() =>
      applyOps(base(), [
        { op: "addSection", page: "/", type: "imageText", props: { heading: "a", body: "b", image: "http://x.test/a.png" } },
      ]),
    ).toThrow(OpError);
  });

  it("needs a home page", () => {
    const tree = base();
    tree.pages[0]!.path = "/home";
    expect(() => parseTree(tree)).toThrow(/home page/);
  });
});

describe("operations", () => {
  it("adds a section after another, with defaults filled", () => {
    const tree = base();
    const next = applyOps(tree, [
      { op: "addSection", page: "/", type: "faq", props: { heading: "FAQ", items: [{ question: "Q", answer: "A" }] }, after: "shop" },
    ]);
    const home = next.pages[0]!;
    const i = home.sections.findIndex((s) => s.id === "shop");
    expect(home.sections[i + 1]!.type).toBe("faq");
    // the input is untouched
    expect(tree.pages[0]!.sections.some((s) => s.type === "faq")).toBe(false);
  });

  it("merges section props and drops nulls", () => {
    const next = applyOps(base(), [
      { op: "updateSection", section: "shop", props: { heading: "New arrivals", subheading: "Fresh" } },
      { op: "updateSection", section: "shop", props: { subheading: null } },
    ]);
    const shop = next.pages[0]!.sections.find((s) => s.id === "shop")!;
    expect(shop.props).toMatchObject({ heading: "New arrivals", limit: 12 });
    expect("subheading" in shop.props).toBe(false);
  });

  it("is atomic: a failing batch changes nothing and names the step", () => {
    const tree = base();
    expect(() =>
      applyOps(tree, [
        { op: "setMeta", title: "Changed" },
        { op: "removeSection", section: "nope" },
      ]),
    ).toThrow(/operation 2 \(removeSection\): no section nope/);
    expect(tree.meta.title).toBe("Pooja Communications");
  });

  it("finds pages by path and protects the home page", () => {
    expect(() => applyOps(base(), [{ op: "removePage", page: "/" }])).toThrow(/home page/);
    const next = applyOps(base(), [{ op: "updatePage", page: "/about", title: "Our story" }]);
    expect(next.pages.find((p) => p.path === "/about")!.title).toBe("Our story");
  });

  it("merges a partial theme", () => {
    const next = applyOps(base(), [{ op: "setTheme", theme: { colors: { primary: "#000000" }, radius: "lg" } }]);
    expect(next.theme.colors.primary).toBe("#000000");
    expect(next.theme.colors.background).toBe("#ffffff");
    expect(next.theme.radius).toBe("lg");
  });
});

describe("diff", () => {
  it("reads edits as changes, not remove + add", () => {
    const a = base();
    const b = applyOps(a, [
      { op: "updateSection", section: "shop", props: { heading: "Bestsellers" } },
      { op: "setTheme", theme: { colors: { primary: "#111111" } } },
    ]);
    const changes = diffTrees(a, b);
    expect(changes.map((c) => c.kind).sort()).toEqual(["section-changed", "theme"]);
    const sc = changes.find((c) => c.kind === "section-changed");
    expect(sc && "fields" in sc && sc.fields).toEqual([{ field: "heading", before: "Shop the range", after: "Bestsellers" }]);
    expect(summarise(changes)).toBe("theme changed, 1 section changed");
  });

  it("notices moves, additions and removed pages", () => {
    const a = base();
    const b = applyOps(a, [
      { op: "moveSection", section: "contact", index: 0 },
      { op: "removePage", page: "/about" },
      { op: "addPage", path: "/faq", title: "FAQ" },
    ]);
    const kinds = diffTrees(a, b).map((c) => c.kind);
    expect(kinds).toContain("section-moved");
    expect(kinds).toContain("page-removed");
    expect(kinds).toContain("page-added");
    expect(diffTrees(a, a)).toEqual([]);
  });

  it("ignores key order (jsonb reorders keys)", () => {
    const a = base();
    const reordered = JSON.parse(JSON.stringify(a), (_k, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).reverse())
        : v,
    );
    expect(diffTrees(a, reordered)).toEqual([]);
  });
});

describe("hosts and subdomains", () => {
  it("parses platform, local and custom hosts", () => {
    expect(parseHost("acme.zuuvy.site", "zuuvy.site")).toEqual({ subdomain: "acme" });
    expect(parseHost("acme.localhost:3001", "zuuvy.site")).toEqual({ subdomain: "acme" });
    expect(parseHost("www.acme.in", "zuuvy.site")).toEqual({ domain: "acme.in" });
    expect(parseHost("zuuvy.site", "zuuvy.site")).toBeNull();
    expect(parseHost("a.b.zuuvy.site", "zuuvy.site")).toBeNull();
  });

  it("refuses reserved and malformed subdomains", () => {
    expect(subdomainProblem("studio")).toMatch(/reserved/);
    expect(subdomainProblem("ab")).toMatch(/3/);
    expect(subdomainProblem("-acme")).not.toBeNull();
    expect(subdomainProblem("pooja-comm")).toBeNull();
  });
});
