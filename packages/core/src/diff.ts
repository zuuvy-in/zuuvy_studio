/**
 * What changed between two versions of a site, in terms a person reads:
 * "Home › Hero: heading changed", not a JSON patch.
 *
 * Sections are matched by id, so an edited section reads as *changed* rather
 * than removed-and-added, and a reordered page reads as *moved*.
 */
import type { Page, Section, SiteTree } from "./tree";

export type FieldChange = { field: string; before: unknown; after: unknown };

export type Change =
  | { kind: "meta" | "theme" | "nav" | "footer" | "commerce"; label: string; fields: FieldChange[] }
  | { kind: "page-added" | "page-removed"; label: string; page: string }
  | { kind: "page-changed"; label: string; page: string; fields: FieldChange[] }
  | {
      kind: "section-added" | "section-removed";
      label: string;
      page: string;
      section: string;
      type: Section["type"];
    }
  | {
      kind: "section-changed";
      label: string;
      page: string;
      section: string;
      type: Section["type"];
      fields: FieldChange[];
    }
  | { kind: "section-moved"; label: string; page: string; section: string; type: Section["type"] };

export const BLOCK_LABELS: Record<Section["type"], string> = {
  hero: "Hero",
  features: "Features",
  productGrid: "Product grid",
  richText: "Text",
  imageText: "Image & text",
  gallery: "Gallery",
  testimonials: "Testimonials",
  stats: "Stats",
  faq: "FAQ",
  cta: "Call to action",
  contact: "Contact",
  logos: "Logos",
  marquee: "Marquee",
  steps: "Steps",
  collection: "Collection",
};

/**
 * Key-order-independent equality. Trees round-trip through Postgres `jsonb`,
 * which reorders object keys, and through zod, which writes them in schema
 * order — the same tree can arrive with its keys in either order.
 */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

const same = sameValue;

/** Field-level differences between two flat-ish objects, one level of nesting unrolled. */
export function fieldChanges(before: object, after: object, prefix = ""): FieldChange[] {
  const out: FieldChange[] = [];
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  for (const key of keys) {
    const x = b[key];
    const y = a[key];
    if (same(x, y)) continue;
    const isPlain = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
    if (isPlain(x) && isPlain(y)) {
      out.push(...fieldChanges(x as object, y as object, `${prefix}${key}.`));
    } else {
      out.push({ field: `${prefix}${key}`, before: x, after: y });
    }
  }
  return out;
}

function pageLabel(page: Page) {
  return page.path === "/" ? "Home" : page.title || page.path;
}

export function diffTrees(from: SiteTree, to: SiteTree): Change[] {
  const changes: Change[] = [];

  for (const kind of ["meta", "theme", "nav", "footer", "commerce"] as const) {
    const fields = fieldChanges(from[kind] ?? {}, to[kind] ?? {});
    if (fields.length) {
      const label = { meta: "Site details", theme: "Theme", nav: "Navigation", footer: "Footer", commerce: "Cart and checkout" }[kind];
      changes.push({ kind, label, fields });
    }
  }

  const fromPages = new Map(from.pages.map((p) => [p.id, p]));
  const toPages = new Map(to.pages.map((p) => [p.id, p]));

  for (const page of to.pages) {
    const old = fromPages.get(page.id);
    if (!old) {
      changes.push({ kind: "page-added", label: `Page added: ${pageLabel(page)} (${page.path})`, page: page.path });
      for (const s of page.sections) {
        changes.push({
          kind: "section-added",
          label: `${pageLabel(page)} › ${BLOCK_LABELS[s.type]} added`,
          page: page.path,
          section: s.id,
          type: s.type,
        });
      }
      continue;
    }

    const pageFields = fieldChanges({ path: old.path, title: old.title }, { path: page.path, title: page.title });
    if (pageFields.length) {
      changes.push({ kind: "page-changed", label: `${pageLabel(page)} page details`, page: page.path, fields: pageFields });
    }

    const oldSections = new Map(old.sections.map((s) => [s.id, s]));
    const newIds = new Set(page.sections.map((s) => s.id));

    for (const s of old.sections) {
      if (!newIds.has(s.id)) {
        changes.push({
          kind: "section-removed",
          label: `${pageLabel(page)} › ${BLOCK_LABELS[s.type]} removed`,
          page: page.path,
          section: s.id,
          type: s.type,
        });
      }
    }

    // Order among the sections both versions share: a section is "moved" when
    // its position relative to the other survivors changed.
    const survivorsBefore = old.sections.filter((s) => newIds.has(s.id)).map((s) => s.id);
    const survivorsAfter = page.sections.filter((s) => oldSections.has(s.id)).map((s) => s.id);

    for (const s of page.sections) {
      const prev = oldSections.get(s.id);
      if (!prev) {
        changes.push({
          kind: "section-added",
          label: `${pageLabel(page)} › ${BLOCK_LABELS[s.type]} added`,
          page: page.path,
          section: s.id,
          type: s.type,
        });
        continue;
      }
      const fields = [
        ...fieldChanges(prev.props, s.props),
        ...fieldChanges(prev.style ?? {}, s.style ?? {}).map((f) => ({ ...f, field: `style.${f.field}` })),
      ];
      if (fields.length) {
        changes.push({
          kind: "section-changed",
          label: `${pageLabel(page)} › ${BLOCK_LABELS[s.type]}`,
          page: page.path,
          section: s.id,
          type: s.type,
          fields,
        });
      }
      if (survivorsBefore.indexOf(s.id) !== survivorsAfter.indexOf(s.id)) {
        changes.push({
          kind: "section-moved",
          label: `${pageLabel(page)} › ${BLOCK_LABELS[s.type]} moved`,
          page: page.path,
          section: s.id,
          type: s.type,
        });
      }
    }
  }

  for (const page of from.pages) {
    if (!toPages.has(page.id)) {
      changes.push({ kind: "page-removed", label: `Page removed: ${pageLabel(page)} (${page.path})`, page: page.path });
    }
  }

  return changes;
}

/** One line for a version list: "3 sections changed, 1 page added". */
export function summarise(changes: Change[]): string {
  if (!changes.length) return "No changes";
  const counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const c of changes) {
    if (c.kind.startsWith("section-")) bump(`section ${c.kind.slice(8)}`);
    else if (c.kind.startsWith("page-")) bump(`page ${c.kind.slice(5)}`);
    else bump(`${c.label.toLowerCase()} changed`);
  }
  return [...counts]
    .map(([k, n]) => {
      if (k.endsWith(" changed") && !k.startsWith("section") && !k.startsWith("page")) return k;
      const [noun, verb] = k.split(" ");
      return `${n} ${noun}${n === 1 ? "" : "s"} ${verb}`;
    })
    .join(", ");
}
