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
    expect(parseHost("www.acme.in", "zuuvy.site")).toEqual({ domain: "www.acme.in" });
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

describe("site data, brand kit and source files", async () => {
  const { applyDataOps, diffData, parseData, overwrites, applyBrand, parseBrand, lockedThemeFields, treeToSource, sourceToTree, getTemplate: tpl } = await import("./index");

  it("validates collections and applies ops with fresh ids", () => {
    expect(() => parseData({ nonsense: [] })).toThrow(/no collection called nonsense/);
    expect(() => parseData({ projects: [{ id: "a" }] })).toThrow(/title/);
    const d = applyDataOps({}, [{ op: "addItem", collection: "projects", item: { id: "spoof", title: "One", year: "2024" } }]);
    expect(d.projects![0]!.id).not.toBe("spoof");
    expect(d.projects![0]!.year).toBe(2024);
    expect(overwrites(d, { op: "updateItem", collection: "projects", id: d.projects![0]!.id, fields: { summary: "new" } })).toBe(false);
    expect(overwrites(d, { op: "updateItem", collection: "projects", id: d.projects![0]!.id, fields: { title: "Two" } })).toBe(true);
    const changes = diffData(d, applyDataOps(d, [{ op: "removeItem", collection: "projects", id: d.projects![0]!.id }]));
    expect(changes).toEqual([{ collection: "projects", label: "Projects", added: [], removed: ["One"], changed: [] }]);
  });

  it("applies the brand kit over any tree", () => {
    const tree = tpl("landing-launch").build({ businessName: "X" });
    const brand = parseBrand({ colors: { primary: "#101010" }, motion: "none", logo: "https://x.test/l.png" });
    const out = applyBrand(tree, brand);
    expect(out.theme.colors.primary).toBe("#101010");
    expect(out.theme.motion).toBe("none");
    expect(out.nav.logo).toBe("https://x.test/l.png");
    expect(lockedThemeFields(brand)).toEqual(["colors.primary", "motion"]);
  });

  it("round-trips a tree and its data through source files, inside a folder", () => {
    const t = tpl("portfolio-studio");
    const tree = t.build({ businessName: "Priya" });
    const data = t.data!({ businessName: "Priya" });
    const files = treeToSource(tree, { siteName: "Priya", kind: "portfolio", version: 3 }, data);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["site/data/projects.json", "site/data/profile.json", "site/pages/01-home.json"]));
    const nested = Object.fromEntries(Object.entries(files).map(([p, c]) => [`priya-v3/${p}`, c]));
    const back = sourceToTree(nested);
    expect(back.tree).toEqual(tree);
    expect(back.data).toEqual(data);
    expect(back.manifest.version).toBe(3);
    const broken = { ...files, "site/pages/01-home.json": JSON.stringify({ ...tree.pages[0], path: "Not A Path" }) };
    expect(() => sourceToTree(broken)).toThrow(/site\/pages\/01-home\.json/);
  });
});
