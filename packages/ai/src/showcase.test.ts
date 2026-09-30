import { SHOWCASE, type SiteTree } from "@zsite/core";
import { describe, expect, it } from "vitest";
import { unknownIcons } from "./icons";

/** Every icon a tree names, wherever it sits. */
function iconsIn(tree: SiteTree): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key = "") => {
    if (typeof v === "string" && key === "icon") out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  for (const p of tree.pages) for (const s of p.sections) walk(s.props);
  return out;
}

describe("premade sites", () => {
  it("are ten distinct designs that parse, with or without pictures", () => {
    expect(SHOWCASE.length).toBe(10);
    expect(new Set(SHOWCASE.map((d) => d.slug)).size).toBe(10);
    for (const d of SHOWCASE) {
      const bare = d.build(() => undefined);
      const full = d.build((slot) => `https://images.example.com/${d.slug}/${slot}.jpg`);
      expect(bare.pages[0]!.sections.length, d.slug).toBeGreaterThanOrEqual(6);
      expect(Object.keys(d.photos)).toContain(d.cover);
      // Every picture slot a design uses is one it asks the library for.
      const used = JSON.stringify(full).match(new RegExp(`images\\.example\\.com/${d.slug}/([\\w]+)\\.jpg`, "g")) ?? [];
      for (const u of used) expect(d.photos, `${d.slug}: ${u}`).toHaveProperty(u.split("/").pop()!.replace(".jpg", ""));
    }
  });

  it("use only icons that exist, and forms point at tables they create", () => {
    for (const d of SHOWCASE) {
      const tree = d.build(() => undefined);
      expect(iconsIn(tree).length, d.slug).toBeGreaterThan(0);
      expect(unknownIcons(tree.pages.map((p) => p.sections.map((s) => s.props))), d.slug).toEqual([]);
      for (const s of tree.pages.flatMap((p) => p.sections)) {
        if (s.type !== "form" || s.props.destination.kind !== "table") continue;
        const table = d.tables?.find((t) => t.key === (s.props.destination as { table: string }).table);
        expect(table, `${d.slug}: ${s.props.destination.table}`).toBeTruthy();
        for (const f of s.props.fields) expect(table!.columns.map((c) => c.key), `${d.slug}.${f.name}`).toContain(f.name);
      }
      if (d.kind === "store") expect(d.products?.length, d.slug).toBeGreaterThan(3);
    }
  });
});
