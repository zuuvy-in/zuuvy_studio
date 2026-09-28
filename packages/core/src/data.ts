/**
 * Site data: the structured content a site shows — a portfolio's profile,
 * projects, experience, skills… — kept apart from the page layout (the tree)
 * so it can be edited like a table, by hand or by the AI, and shown by any
 * number of `collection` sections.
 *
 * Data is part of a version, exactly like the tree: every version holds the
 * whole of it, immutably. So the version a change was made on *is* the backup
 * from before the change, and going back to a version can reset any
 * collection (table) to what it held there, one table at a time.
 *
 * The field specs below are the single description of each collection: the
 * validation, the studio's edit forms, the AI's tool schema and the runtime's
 * rendering all read them.
 */
import { z } from "zod";
import { DATA_COLLECTION_KEYS, Href, ImageUrl } from "./tree";

export type FieldKind = "text" | "textarea" | "url" | "image" | "year" | "tags" | "email" | "phone";
export type FieldSpec = { key: string; label: string; kind: FieldKind; required?: boolean; max?: number };

export type CollectionSpec = {
  key: string;
  label: string;
  /** One record (a profile) rather than a list. */
  single?: boolean;
  /** The field that names an item in lists, diffs and prompts. */
  titleField: string;
  fields: FieldSpec[];
  /** What the AI and the studio are told the collection is for. */
  description: string;
  defaultLayout: CollectionLayout;
};

export const COLLECTION_LAYOUTS = ["cards", "grid", "list", "timeline", "chips", "about"] as const;
export type CollectionLayout = (typeof COLLECTION_LAYOUTS)[number];

const f = (key: string, label: string, kind: FieldKind, extra: Partial<FieldSpec> = {}): FieldSpec => ({ key, label, kind, ...extra });

export const COLLECTIONS: CollectionSpec[] = [
  {
    key: "profile",
    label: "Profile",
    single: true,
    titleField: "name",
    description: "Who the site is about: name, headline, bio, photo, location and ways to get in touch.",
    defaultLayout: "about",
    fields: [
      f("name", "Name", "text", { required: true, max: 120 }),
      f("headline", "Headline", "text", { max: 160 }),
      f("bio", "Bio", "textarea", { max: 3000 }),
      f("photo", "Photo", "image"),
      f("location", "Location", "text", { max: 120 }),
      f("email", "Email", "email"),
      f("phone", "Phone", "phone"),
      f("website", "Website", "url"),
      f("linkedin", "LinkedIn", "url"),
      f("github", "GitHub", "url"),
      f("instagram", "Instagram", "url"),
      f("behance", "Behance / Dribbble", "url"),
      f("resume", "Résumé (link)", "url"),
    ],
  },
  {
    key: "projects",
    label: "Projects",
    titleField: "title",
    description: "Work to show: case studies, products, campaigns, builds.",
    defaultLayout: "cards",
    fields: [
      f("title", "Title", "text", { required: true, max: 140 }),
      f("summary", "Summary", "text", { max: 300 }),
      f("description", "Description", "textarea", { max: 3000 }),
      f("image", "Image", "image"),
      f("link", "Link", "url"),
      f("role", "Role", "text", { max: 120 }),
      f("client", "Client", "text", { max: 120 }),
      f("year", "Year", "year"),
      f("tags", "Tags", "tags"),
    ],
  },
  {
    key: "experience",
    label: "Experience",
    titleField: "role",
    description: "Jobs and engagements, newest first.",
    defaultLayout: "timeline",
    fields: [
      f("role", "Role", "text", { required: true, max: 140 }),
      f("organisation", "Organisation", "text", { required: true, max: 140 }),
      f("start", "From", "text", { max: 40 }),
      f("end", "To", "text", { max: 40 }),
      f("location", "Location", "text", { max: 120 }),
      f("summary", "What you did", "textarea", { max: 2000 }),
    ],
  },
  {
    key: "education",
    label: "Education",
    titleField: "qualification",
    description: "Degrees, diplomas and courses.",
    defaultLayout: "timeline",
    fields: [
      f("qualification", "Qualification", "text", { required: true, max: 160 }),
      f("institution", "Institution", "text", { required: true, max: 160 }),
      f("start", "From", "text", { max: 40 }),
      f("end", "To", "text", { max: 40 }),
      f("details", "Details", "textarea", { max: 1500 }),
    ],
  },
  {
    key: "skills",
    label: "Skills",
    titleField: "name",
    description: "Skills and tools, optionally grouped (Design, Engineering…).",
    defaultLayout: "chips",
    fields: [f("name", "Skill", "text", { required: true, max: 80 }), f("group", "Group", "text", { max: 60 }), f("level", "Level", "text", { max: 40 })],
  },
  {
    key: "services",
    label: "Services",
    titleField: "title",
    description: "What can be hired for, with an optional starting price.",
    defaultLayout: "cards",
    fields: [f("title", "Service", "text", { required: true, max: 120 }), f("description", "Description", "textarea", { max: 1500 }), f("price", "Price (text)", "text", { max: 60 })],
  },
  {
    key: "testimonials",
    label: "Testimonials",
    titleField: "author",
    description: "What clients and colleagues say. Only real quotes the owner provided.",
    defaultLayout: "cards",
    fields: [f("quote", "Quote", "textarea", { required: true, max: 800 }), f("author", "Name", "text", { required: true, max: 100 }), f("role", "Role / company", "text", { max: 120 })],
  },
  {
    key: "awards",
    label: "Awards",
    titleField: "title",
    description: "Awards, recognition and certifications.",
    defaultLayout: "list",
    fields: [f("title", "Award", "text", { required: true, max: 160 }), f("issuer", "Given by", "text", { max: 120 }), f("year", "Year", "year"), f("description", "Details", "textarea", { max: 800 })],
  },
  {
    key: "publications",
    label: "Publications & talks",
    titleField: "title",
    description: "Articles, papers, talks and press.",
    defaultLayout: "list",
    fields: [f("title", "Title", "text", { required: true, max: 200 }), f("venue", "Where", "text", { max: 160 }), f("year", "Year", "year"), f("link", "Link", "url")],
  },
  {
    key: "clients",
    label: "Clients",
    titleField: "name",
    description: "Businesses worked with, optionally with a logo.",
    defaultLayout: "grid",
    fields: [f("name", "Name", "text", { required: true, max: 120 }), f("logo", "Logo", "image"), f("link", "Link", "url")],
  },
  {
    key: "gallery",
    label: "Gallery",
    titleField: "caption",
    description: "Photos and visuals that do not need a project page.",
    defaultLayout: "grid",
    fields: [f("image", "Image", "image", { required: true }), f("caption", "Caption", "text", { max: 200 })],
  },
];

export const COLLECTION_KEYS = COLLECTIONS.map((c) => c.key) as [string, ...string[]];
// tree.ts lists the same keys for the `collection` block (it cannot import this module without a cycle).
if (COLLECTION_KEYS.join() !== DATA_COLLECTION_KEYS.join()) throw new Error("tree.ts DATA_COLLECTION_KEYS is out of step with data.ts");
export const collectionSpec = (key: string) => COLLECTIONS.find((c) => c.key === key);

function fieldSchema(spec: FieldSpec): z.ZodType {
  const max = spec.max ?? 500;
  switch (spec.kind) {
    case "url":
      return Href;
    case "image":
      return ImageUrl;
    case "email":
      return z.email().max(200);
    case "phone":
      return z.string().max(20).regex(/^[+0-9 ()-]{6,20}$/, "a phone number");
    case "year":
      return z.union([z.number().int().min(1900).max(2100), z.string().regex(/^\d{4}$/).transform(Number)]);
    case "tags":
      return z.array(z.string().max(40)).max(12);
    default:
      return z.string().max(max);
  }
}

const itemSchemas = new Map<string, z.ZodObject>();

/** The zod schema of one item of a collection (id included for lists). */
export function itemSchema(key: string): z.ZodObject {
  const cached = itemSchemas.get(key);
  if (cached) return cached;
  const spec = collectionSpec(key);
  if (!spec) throw new Error(`unknown collection ${key}`);
  const shape: Record<string, z.ZodType> = spec.single ? {} : { id: z.string().min(1).max(40) };
  for (const field of spec.fields) {
    const s = fieldSchema(field);
    shape[field.key] = field.required ? s : s.optional();
  }
  const schema = z.object(shape);
  itemSchemas.set(key, schema);
  return schema;
}

export type DataItem = Record<string, unknown> & { id?: string };
/** collection key → items (a single collection holds at most one item). */
export type SiteData = Record<string, DataItem[]>;

export const LIST_MAX = 60;

export class DataError extends Error {
  override name = "DataError";
}

/** Validate and normalise a whole data set; unknown collections are refused. */
export function parseData(input: unknown): SiteData {
  if (input === null || input === undefined) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new DataError("data is an object of collections");
  const out: SiteData = {};
  for (const [key, items] of Object.entries(input as Record<string, unknown>)) {
    const spec = collectionSpec(key);
    if (!spec) throw new DataError(`there is no collection called ${key}`);
    if (!Array.isArray(items)) throw new DataError(`${key} is a list`);
    if (spec.single && items.length > 1) throw new DataError(`${key} holds one record`);
    if (items.length > LIST_MAX) throw new DataError(`${key} holds at most ${LIST_MAX} entries`);
    const ids = new Set<string>();
    out[key] = items.map((raw, i) => {
      const r = itemSchema(key).safeParse(raw);
      if (!r.success) throw new DataError(`${spec.label} #${i + 1}: ${r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`);
      const item = r.data as DataItem;
      if (!spec.single) {
        if (ids.has(item.id!)) throw new DataError(`${spec.label}: id ${item.id} is used twice`);
        ids.add(item.id!);
      }
      return item;
    });
    if (!out[key]!.length) delete out[key];
  }
  return out;
}

export function itemTitle(key: string, item: DataItem): string {
  const spec = collectionSpec(key);
  const v = spec ? item[spec.titleField] : undefined;
  return typeof v === "string" && v ? v : spec?.single ? spec.label : String(item.id ?? "entry");
}

// ---------------------------------------------------------------------------
// Operations on data — the only way it changes.
// ---------------------------------------------------------------------------

export type DataOp =
  | { op: "addItem"; collection: string; item: Record<string, unknown>; index?: number }
  | { op: "updateItem"; collection: string; id?: string; fields: Record<string, unknown> }
  | { op: "removeItem"; collection: string; id?: string }
  | { op: "moveItem"; collection: string; id: string; index: number }
  | { op: "replaceCollection"; collection: string; items: DataItem[] };

const newItemId = () => `i_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;

/** Whether an op changes something that already exists — the ones the AI must ask about. */
export function overwrites(data: SiteData, op: DataOp): boolean {
  const items = data[op.collection] ?? [];
  switch (op.op) {
    case "addItem":
      // Adding to a one-record collection that already has its record replaces it.
      return Boolean(collectionSpec(op.collection)?.single && items.length);
    case "updateItem": {
      const spec = collectionSpec(op.collection);
      const target = spec?.single ? items[0] : items.find((i) => i.id === op.id);
      if (!target) return false;
      // Filling an empty field is not overwriting anything.
      return Object.entries(op.fields).some(([k, v]) => target[k] !== undefined && target[k] !== "" && JSON.stringify(target[k]) !== JSON.stringify(v));
    }
    case "removeItem":
    case "replaceCollection":
      return items.length > 0;
    case "moveItem":
      return false;
  }
}

/** Apply ops, validating the result; returns the new data (the input is untouched). */
export function applyDataOps(data: SiteData, ops: DataOp[]): SiteData {
  const next: SiteData = structuredClone(data);
  for (const op of ops) {
    const spec = collectionSpec(op.collection);
    if (!spec) throw new DataError(`there is no collection called ${op.collection}; use one of ${COLLECTION_KEYS.join(", ")}`);
    const items = (next[op.collection] ??= []);
    const find = (id?: string) => {
      const i = spec.single ? (items.length ? 0 : -1) : items.findIndex((x) => x.id === id);
      if (i < 0) throw new DataError(spec.single ? `${spec.label} is empty; add it first` : `no ${spec.label} entry with id ${id}`);
      return i;
    };
    switch (op.op) {
      case "addItem": {
        // Ids are the platform's to give; one sent in is ignored.
        const { id: _ignored, ...fields } = op.item;
        const item: DataItem = spec.single ? fields : { ...fields, id: newItemId() };
        if (spec.single) items.splice(0, items.length, item);
        else items.splice(op.index ?? items.length, 0, item);
        break;
      }
      case "updateItem": {
        const i = find(op.id);
        const merged: DataItem = { ...items[i]! };
        for (const [k, v] of Object.entries(op.fields)) {
          if (k === "id") continue;
          if (v === null || v === "") delete merged[k];
          else merged[k] = v;
        }
        items[i] = merged;
        break;
      }
      case "removeItem":
        items.splice(find(op.id), 1);
        break;
      case "moveItem": {
        const [item] = items.splice(find(op.id), 1);
        items.splice(Math.max(0, Math.min(op.index, items.length)), 0, item!);
        break;
      }
      case "replaceCollection":
        next[op.collection] = op.items.map((it) => (spec.single ? it : { ...it, id: it.id ?? newItemId() }));
        break;
    }
  }
  return parseData(next);
}

export type DataChange = { collection: string; label: string; added: string[]; removed: string[]; changed: string[] };

/** What changed between two data sets, per collection, in names people recognise. */
export function diffData(a: SiteData | null | undefined, b: SiteData | null | undefined): DataChange[] {
  const out: DataChange[] = [];
  for (const spec of COLLECTIONS) {
    const x = a?.[spec.key] ?? [];
    const y = b?.[spec.key] ?? [];
    const key = (i: DataItem, n: number) => (spec.single ? "one" : (i.id ?? String(n)));
    const xm = new Map(x.map((i, n) => [key(i, n), i]));
    const ym = new Map(y.map((i, n) => [key(i, n), i]));
    const added = [...ym.keys()].filter((k) => !xm.has(k)).map((k) => itemTitle(spec.key, ym.get(k)!));
    const removed = [...xm.keys()].filter((k) => !ym.has(k)).map((k) => itemTitle(spec.key, xm.get(k)!));
    const canon = (v: unknown) => JSON.stringify(v, Object.keys((v ?? {}) as object).sort());
    const changed = [...ym.keys()].filter((k) => xm.has(k) && canon(xm.get(k)) !== canon(ym.get(k))).map((k) => itemTitle(spec.key, ym.get(k)!));
    const reordered = !added.length && !removed.length && !changed.length && [...xm.keys()].join() !== [...ym.keys()].join();
    if (added.length || removed.length || changed.length || reordered) {
      out.push({ collection: spec.key, label: spec.label, added, removed, changed: reordered ? ["order"] : changed });
    }
  }
  return out;
}

export function summariseData(changes: DataChange[]): string {
  return changes
    .map((c) => {
      const parts = [
        c.added.length ? `added ${c.added.length}` : "",
        c.changed.length ? `changed ${c.changed.length}` : "",
        c.removed.length ? `removed ${c.removed.length}` : "",
      ].filter(Boolean);
      return `${c.label}: ${parts.join(", ")}`;
    })
    .join("; ");
}

/** A readable description of a proposed op, for the permission prompt. */
export function describeDataOp(data: SiteData, op: DataOp): string {
  const spec = collectionSpec(op.collection);
  const label = spec?.label ?? op.collection;
  const items = data[op.collection] ?? [];
  const target = spec?.single ? items[0] : items.find((i) => "id" in op && i.id === op.id);
  const name = target ? itemTitle(op.collection, target) : "";
  switch (op.op) {
    case "updateItem":
      return `Change ${Object.keys(op.fields).join(", ")} of ${label}${name ? ` “${name}”` : ""}`;
    case "removeItem":
      return `Remove ${label}${name ? ` “${name}”` : ""}`;
    case "replaceCollection":
      return `Replace all ${items.length} ${label} entries with ${op.items.length} new ones`;
    case "addItem":
      return spec?.single ? `Replace the ${label}` : `Add to ${label}`;
    case "moveItem":
      return `Reorder ${label}`;
  }
}
