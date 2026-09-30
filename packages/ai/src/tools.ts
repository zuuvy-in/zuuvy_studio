/**
 * The agent's tools: one per site-tree operation, plus a way to look at the
 * site as it stands mid-edit. Every call goes through `applyOps`, so the model
 * cannot produce a tree the runtime would refuse — an invalid call comes back
 * as a tool error in words it can correct ("hero props: heading: Required").
 */
import {
  BLOCK_TYPES,
  type BlockType,
  COLLECTION_KEYS,
  type DataOp,
  FONTS,
  MOTIONS,
  type Operation,
  type SiteData,
  type SiteTree,
  applyDataOps,
  applyOps,
  describeDataOp,
  overwrites,
} from "@zsite/core";
import { z } from "zod";
import { searchIcons, unknownIcons } from "./icons";

export type EditState = {
  tree: SiteTree;
  operations: Operation[];
  images: number;
  references: number;
  data: SiteData;
  dataOperations: DataOp[];
  /** Changes to existing data the owner has to allow first. */
  proposals: Proposal[];
  /** Why picture generation failed in this turn, if it did — it is not retried. */
  imageError?: string;
  /** Tables to create or change, applied when the version is saved. */
  tableOps: TableOpSpec[];
  /** Tables the AI wants gone: held for the owner, who sees how many rows each holds. */
  tableDeletes: { key: string; reason: string }[];
};

export type TableColumnSpec = { key: string; label: string; type: "text" | "email" | "tel" | "number" | "textarea" | "select" | "pills" | "checkbox" | "date" };
export type TableOpSpec =
  | { op: "create"; key: string; name: string; columns: TableColumnSpec[]; notify?: boolean }
  | { op: "update"; key: string; name?: string; columns?: TableColumnSpec[]; notify?: boolean };
/** A table the site already has, as the AI is told about it. */
export type TableSummary = { key: string; name: string; columns: TableColumnSpec[]; rows: number };

export type Proposal = { op: DataOp; description: string };

/** A picture made for this site; `url` is public https and usable in any image field. */
export type GeneratedImage = { url: string; width: number; height: number };
export type ImageAspect = "wide" | "landscape" | "square" | "portrait";
export type ImageStyle = "photo" | "illustration" | "3d" | "flat";

/** What a reference website looks like, reduced to what a designer would note. */
export type ReferenceSummary = {
  url: string;
  title: string;
  description: string;
  headings: string[];
  navigation: string[];
  sections: string[];
  colors: string[];
  fonts: string[];
  text: string;
};

/**
 * What the agent may do beyond editing the tree. Each is supplied by the
 * platform (object storage, Bedrock image models, a guarded fetch); absent
 * means the tool is not offered at all, rather than offered and failing.
 */
export type ToolCapabilities = {
  generateImage?: (req: { prompt: string; aspect: ImageAspect; style: ImageStyle }) => Promise<GeneratedImage>;
  /**
   * Copy a picture into the media library and get a permanent URL: an asset
   * service's download link (from an allowed host) or an SVG it handed over.
   */
  importImage?: (req: { url?: string; svg?: string; alt: string }) => Promise<{ url: string }>;
  fetchReference?: (url: string) => Promise<ReferenceSummary>;
  /**
   * Theme fields the owner fixed in the brand kit (`colors.primary`, `fonts.body`,
   * `motion`). set_theme keeps them and says so, rather than failing the call.
   */
  lockedTheme?: string[];
  /** Colours to steer generated pictures toward (the brand palette). */
  imagePalette?: string[];
  /**
   * Collections the owner has allowed the AI to change or remove existing
   * entries in, for this request. Everywhere else such changes become proposals.
   */
  allowOverwrite?: string[];
  /**
   * Whether this site uses data collections (a portfolio, or a site that
   * already shows one). Off: no data tools, and no new `collection` sections.
   */
  dataTools?: boolean;
  /** A store: the cart, checkout and account presentation can be set (set_commerce). */
  /** "store": cart, checkout and accounts; "accounts": a site with sign-in but nothing to sell. */
  commerceTools?: boolean | "store" | "accounts";
  /** The site's tables (for forms). Present = the table tools are offered. */
  tables?: TableSummary[];
  /** Per edit, so one prompt cannot spend a month of image budget. */
  maxImages?: number;
  maxReferences?: number;
};

/**
 * A tool as the agent defines it, independent of any model provider. Each
 * provider adapter (providers/*.ts) turns these into its own tool format;
 * `run` validates its input itself, so no provider's parsing is trusted.
 */
export type SiteTool = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  /** Sent to the model instead of `inputSchema`'s JSON Schema — for tools defined elsewhere (MCP servers), which validate their own input. */
  jsonSchema?: Record<string, unknown>;
  run: (input: unknown) => string | Promise<string>;
};

/** Thrown for input the model got wrong; its message goes back to the model. */
export class ToolInputError extends Error {
  override name = "ToolInputError";
}

function siteTool<S extends z.ZodType>(def: {
  name: string;
  description: string;
  inputSchema: S;
  run: (input: z.infer<S>) => string | Promise<string>;
}): SiteTool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    run: (raw) => {
      const parsed = def.inputSchema.safeParse(raw ?? {});
      if (!parsed.success) {
        throw new ToolInputError(parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
      }
      return def.run(parsed.data);
    },
  };
}

const LinkInput = z.object({ label: z.string(), href: z.string() });
const hex = z.string().describe("#rrggbb");

/** A compact outline: enough to refer to things by id without the full JSON. */
export function outline(tree: SiteTree): string {
  return tree.pages
    .map((p) => {
      const sections = p.sections
        .map((s) => {
          const props = s.props as Record<string, unknown>;
          const title = (props.heading ?? props.title ?? "") as string;
          return `    - ${s.id} (${s.type})${title ? ` "${String(title).slice(0, 60)}"` : ""}`;
        })
        .join("\n");
      return `- page ${p.id} path=${p.path} "${p.title}"\n${sections || "    (no sections)"}`;
    })
    .join("\n");
}

export function createSiteTools(initial: SiteTree, caps: ToolCapabilities = {}, initialData: SiteData = {}) {
  const state: EditState = { tree: initial, operations: [], images: 0, references: 0, data: initialData, dataOperations: [], proposals: [], tableOps: [], tableDeletes: [] };
  const allowed = new Set(caps.allowOverwrite ?? []);

  /** Apply a data op now, or — when it changes what exists — keep it for the owner to allow. */
  const dataOp = (op: DataOp): string => {
    if (overwrites(state.data, op) && !allowed.has(op.collection)) {
      applyDataOps(state.data, [op]); // validate now, so a proposal is always applicable
      const description = describeDataOp(state.data, op);
      state.proposals.push({ op, description });
      return JSON.stringify({
        ok: true,
        proposed: true,
        note: `Not applied: "${description}" changes the owner's existing data, so they will be asked first. Carry on with the rest; mention it in your summary.`,
      });
    }
    state.data = applyDataOps(state.data, [op]);
    state.dataOperations.push(op);
    const items = state.data[op.collection] ?? [];
    return JSON.stringify({ ok: true, id: op.op === "addItem" ? items.at(op.index ?? -1)?.id : undefined, count: items.length });
  };
  const collection = z.enum(COLLECTION_KEYS).describe("A data collection (see Data collections in the system prompt)");

  const apply = (op: Operation, result: (tree: SiteTree) => Record<string, unknown> = () => ({})) => {
    // applyOps throws OpError with a readable message; every provider adapter
    // turns a throw into an error tool result the model can correct.
    const next = applyOps(state.tree, [op]);
    state.tree = next;
    state.operations.push(op);
    return JSON.stringify({ ok: true, ...result(next) });
  };

  /** A name the runtime cannot draw would silently show nothing; say so, with names that exist. */
  const checkIcons = (props: unknown) => {
    const bad = [...new Set(unknownIcons(props))];
    if (!bad.length) return;
    throw new ToolInputError(
      `No icon called ${bad.map((b) => `"${b}"`).join(", ")}. Icons are Lucide names; for example ${bad
        .map((b) => `for "${b}": ${searchIcons(b, 5).join(", ") || "search with design__search_icons"}`)
        .join("; ")}.`,
    );
  };

  /** Tables as they will be after this edit: the site's own, plus what was created or changed so far. */
  const tablesNow = (): Map<string, { name: string; columns: TableColumnSpec[]; rows: number }> => {
    const map = new Map((caps.tables ?? []).map((t) => [t.key, { name: t.name, columns: t.columns, rows: t.rows }]));
    for (const d of state.tableDeletes) map.delete(d.key);
    for (const op of state.tableOps) {
      const was = map.get(op.key);
      if (op.op === "create") map.set(op.key, { name: op.name, columns: op.columns, rows: was?.rows ?? 0 });
      else if (was) map.set(op.key, { name: op.name ?? was.name, columns: op.columns ?? was.columns, rows: was.rows });
    }
    return map;
  };

  /** Text is text: markup typed into a prop would show on the page as code. */
  const checkNoHtml = (value: unknown, path = "props") => {
    if (typeof value === "string") {
      if (/<\/?(?:[a-z][a-z0-9]*)(?:\s[^<>]*)?\/?>/i.test(value)) {
        throw new ToolInputError(
          `${path} contains HTML. Text fields are plain text and show exactly as typed — use a table block for tables, a form block for forms, and blank lines or "- " lines for paragraphs and lists.`,
        );
      }
      return;
    }
    if (Array.isArray(value)) value.forEach((v, i) => checkNoHtml(v, `${path}[${i}]`));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) checkNoHtml(v, `${path}.${k}`);
  };

  /** A form that stores answers must point at a table that exists, and ask only for its columns. */
  const checkForm = (type: string, props: unknown) => {
    if (type !== "form" || !props || typeof props !== "object") return;
    const p = props as { destination?: { kind?: string; table?: string }; fields?: { name?: string }[] };
    if (p.destination?.kind !== "table" || !p.destination.table) return;
    if (!caps.tables) throw new ToolInputError("Forms that store answers are not available here; send them to a URL instead.");
    const table = tablesNow().get(p.destination.table);
    if (!table) throw new ToolInputError(`There is no table "${p.destination.table}". Create it first with create_table, with a column for each field.`);
    const keys = new Set(table.columns.map((c) => c.key));
    const missing = (p.fields ?? []).map((f) => f.name ?? "").filter((n) => n && !keys.has(n));
    if (missing.length) throw new ToolInputError(`The table "${p.destination.table}" has no column for ${missing.join(", ")}. Add them with update_table first.`);
  };

  const tools: SiteTool[] = [
    siteTool({
      name: "view_site",
      description:
        "Return the full current site tree as JSON, including edits made so far in this turn. Use it when you need exact props before changing a section.",
      inputSchema: z.object({}),
      run: () => JSON.stringify(state.tree),
    }),
    siteTool({
      name: "add_section",
      description:
        "Add a section (one block) to a page. `props` must match the block's schema from the system prompt. Returns the new section's id.",
      inputSchema: z.object({
        page: z.string().describe("Page id or path, e.g. / or /about"),
        type: z.enum(BLOCK_TYPES as [string, ...string[]]),
        props: z.record(z.string(), z.unknown()),
        style: z.record(z.string(), z.unknown()).optional().describe("Optional section style (see style_section)"),
        after: z.string().optional().describe("Insert after this section id; omit to append"),
        index: z.number().int().min(0).optional().describe("Insert at this position (0 = top); ignored when `after` is given"),
      }),
      run: (i) => {
        if (i.type === "collection" && caps.dataTools === false) {
          throw new ToolInputError("Collection sections are for portfolio sites. Use features, gallery, testimonials or other blocks here.");
        }
        checkIcons(i.props);
        checkNoHtml(i.props);
        checkForm(i.type, i.props);
        const before = new Set(state.tree.pages.flatMap((p) => p.sections.map((s) => s.id)));
        const out = apply(
          { op: "addSection", page: i.page, type: i.type as BlockType, props: i.props, ...(i.after ? { after: i.after } : {}), ...(i.index !== undefined ? { index: i.index } : {}) },
          (tree) => ({ section: tree.pages.flatMap((p) => p.sections).find((s) => !before.has(s.id))?.id }),
        );
        const id = (JSON.parse(out) as { section?: string }).section;
        if (id && i.style && Object.keys(i.style).length) apply({ op: "styleSection", section: id, style: i.style });
        return out;
      },
    }),
    siteTool({
      name: "style_section",
      description:
        "Set how a section looks: background (default, surface, primary, dark, gradient, mesh, image + image URL), pattern (none, dots, grid, noise), divider — the shape of its bottom edge (none, wave, slant, curve), spacing (compact, normal, roomy), and animation — how it enters on scroll (auto, rise, fade, zoom, slide, blur, none). Send only what changes; null clears a field; {} resets the section to plain. Alternate backgrounds down a page for rhythm.",
      inputSchema: z.object({ section: z.string(), style: z.record(z.string(), z.unknown()) }),
      run: (i) => apply({ op: "styleSection", section: i.section, style: i.style }),
    }),
    siteTool({
      name: "update_section",
      description:
        "Change some props of a section. Send only the fields to change; arrays (items) are replaced whole. Send null to clear an optional field.",
      inputSchema: z.object({ section: z.string(), props: z.record(z.string(), z.unknown()) }),
      run: (i) => {
        checkIcons(i.props);
        checkNoHtml(i.props);
        const section = state.tree.pages.flatMap((p) => p.sections).find((x) => x.id === i.section);
        if (section) checkForm(section.type, { ...(section.props as object), ...i.props });
        return apply({ op: "updateSection", section: i.section, props: i.props });
      },
    }),
    siteTool({
      name: "remove_section",
      description: "Remove a section.",
      inputSchema: z.object({ section: z.string() }),
      run: (i) => apply({ op: "removeSection", section: i.section }),
    }),
    siteTool({
      name: "move_section",
      description: "Move a section to a position on its page (0 = top).",
      inputSchema: z.object({ section: z.string(), index: z.number().int().min(0) }),
      run: (i) => apply({ op: "moveSection", section: i.section, index: i.index }),
    }),
    siteTool({
      name: "add_page",
      description: "Add an empty page. Add sections to it afterwards, and a nav link if people should find it.",
      inputSchema: z.object({ path: z.string().describe("/lowercase-words"), title: z.string() }),
      run: (i) =>
        apply({ op: "addPage", path: i.path, title: i.title }, (tree) => ({ page: tree.pages.find((p) => p.path === i.path)?.id })),
    }),
    siteTool({
      name: "update_page",
      description: "Rename a page or change its path. The home page stays at /.",
      inputSchema: z.object({ page: z.string(), path: z.string().optional(), title: z.string().optional() }),
      run: (i) => apply({ op: "updatePage", page: i.page, ...(i.path ? { path: i.path } : {}), ...(i.title ? { title: i.title } : {}) }),
    }),
    siteTool({
      name: "remove_page",
      description: "Remove a page (not the home page). Also remove links to it.",
      inputSchema: z.object({ page: z.string() }),
      run: (i) => apply({ op: "removePage", page: i.page }),
    }),
    siteTool({
      name: "set_theme",
      description: `Change colours, fonts or corner radius. Send only what changes. Fonts: ${FONTS.join(", ")}. Keep text readable against background and surface.`,
      inputSchema: z.object({
        colors: z
          .object({ primary: hex, background: hex, surface: hex, text: hex, muted: hex, accent: hex })
          .partial()
          .optional(),
        fonts: z.object({ heading: z.enum(FONTS), body: z.enum(FONTS) }).partial().optional(),
        radius: z.enum(["none", "sm", "md", "lg", "full"]).optional(),
        motion: z
          .enum(MOTIONS)
          .optional()
          .describe("Animation: none (still), subtle (sections ease in, cards lift — the default), lively (bigger movement, drifting hero image)"),
        iconPack: z
          .string()
          .optional()
          .describe('The site\'s one icon family, recorded so later edits match: "lucide", or "icons8:<pack apiCode>" once you pick an Icons8 pack'),
        illustrationStyle: z.string().optional().describe("The site's one illustration style (an Icons8 Ouch style id), recorded when you first pick one"),
      }),
      run: (i) => {
        const locked = new Set(caps.lockedTheme ?? []);
        const kept: string[] = [];
        const theme = {
          ...i,
          colors: i.colors && Object.fromEntries(Object.entries(i.colors).filter(([k]) => !locked.has(`colors.${k}`) || !kept.push(`colors.${k}`))),
          fonts: i.fonts && Object.fromEntries(Object.entries(i.fonts).filter(([k]) => !locked.has(`fonts.${k}`) || !kept.push(`fonts.${k}`))),
          motion: i.motion && locked.has("motion") ? (kept.push("motion"), undefined) : i.motion,
        };
        const note = kept.length ? { kept: kept, note: `${kept.join(", ")} fixed by the owner's brand kit and left unchanged; design around them.` } : {};
        return apply({ op: "setTheme", theme }, () => note);
      },
    }),
    siteTool({
      name: "set_site_details",
      description: "Set the site's title and description (browser tab and search results).",
      inputSchema: z.object({ title: z.string().optional(), description: z.string().optional() }),
      run: (i) => apply({ op: "setMeta", ...i }),
    }),
    siteTool({
      name: "set_navigation",
      description: "Set the header: brand name, links (max 8), and an optional button (null removes it).",
      inputSchema: z.object({
        brand: z.string().optional(),
        links: z.array(LinkInput).optional(),
        cta: LinkInput.nullable().optional(),
      }),
      run: (i) => apply({ op: "setNav", ...i }),
    }),
    siteTool({
      name: "set_footer",
      description: "Set the footer text and links.",
      inputSchema: z.object({ text: z.string().optional(), links: z.array(LinkInput).optional() }),
      run: (i) => apply({ op: "setFooter", ...i }),
    }),
  ];

  if (caps.tables) {
    const column = z.object({
      key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).describe("lowercase_with_underscores; a form field's name"),
      label: z.string().max(80),
      type: z.enum(["text", "email", "tel", "number", "textarea", "select", "pills", "checkbox", "date"]).default("text"),
    });
    const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
    tools.push(
      siteTool({
        name: "list_tables",
        description: "The site's tables (where forms store answers), with their columns and how many rows each holds, including changes made so far in this edit.",
        inputSchema: z.object({}),
        run: () => JSON.stringify([...tablesNow()].map(([k, t]) => ({ key: k, ...t }))),
      }),
      siteTool({
        name: "create_table",
        description:
          "Create a table for a form's answers — contact enquiries, bookings, quote requests, sign-ups. One column per form field (same keys). Then add a form block whose destination is this table. The owner reads the answers in the studio and is emailed about new ones when notify is on.",
        inputSchema: z.object({ key, name: z.string().max(80), columns: z.array(column).min(1).max(30), notify: z.boolean().default(true) }),
        run: (i) => {
          if (tablesNow().has(i.key)) throw new ToolInputError(`A table "${i.key}" already exists; change it with update_table.`);
          const keys = new Set<string>();
          for (const c of i.columns) {
            if (keys.has(c.key)) throw new ToolInputError(`Column ${c.key} is listed twice.`);
            keys.add(c.key);
          }
          state.tableOps.push({ op: "create", key: i.key, name: i.name, columns: i.columns, notify: i.notify });
          return JSON.stringify({ ok: true, table: i.key, note: "Created when this version is saved. Now add a form block with destination { kind: 'table', table: '" + i.key + "' }." });
        },
      }),
      siteTool({
        name: "update_table",
        description:
          "Rename a table, change its columns (send the full list; removing a column hides it but keeps what was already sent), or turn email notifications on or off.",
        inputSchema: z.object({ key, name: z.string().max(80).optional(), columns: z.array(column).min(1).max(30).optional(), notify: z.boolean().optional() }),
        run: (i) => {
          if (!tablesNow().has(i.key)) throw new ToolInputError(`There is no table "${i.key}". list_tables shows what exists.`);
          state.tableOps.push({ op: "update", key: i.key, ...(i.name ? { name: i.name } : {}), ...(i.columns ? { columns: i.columns } : {}), ...(i.notify !== undefined ? { notify: i.notify } : {}) });
          return JSON.stringify({ ok: true });
        },
      }),
      siteTool({
        name: "delete_table",
        description:
          "Ask to delete a table and every answer in it. It is never deleted by you: the owner is asked and sees how many answers would be lost. Remove or repoint any form that uses it as well.",
        inputSchema: z.object({ key, reason: z.string().max(200) }),
        run: (i) => {
          const t = tablesNow().get(i.key);
          if (!t) throw new ToolInputError(`There is no table "${i.key}".`);
          state.tableDeletes.push({ key: i.key, reason: i.reason });
          return JSON.stringify({ ok: true, proposed: true, note: `Held for the owner (${t.rows} answers). Mention it in your summary.` });
        },
      }),
    );
  }

  if (caps.commerceTools) {
    const store = caps.commerceTools !== "accounts";
    const display = z.enum(["icon", "icon_label", "label", "button", "pill"]);
    const words = (max: number) => z.string().max(max);
    tools.push(
      siteTool({
        name: "set_commerce",
        description: [
          store
            ? "Decide how this store sells and how its shopping pieces look — they are part of the design, so fit them to the header, the brand and the customer. Send only what changes."
            : "Decide how this site's customer accounts look (the site has sign-in but sells nothing: there is no cart). Send only what changes.",
          store
            ? "cart: drawer or its own page; icon bag/cart/basket; in the header (nav) or a floating round button (long, image-led mobile pages); label; display. buy: add to cart, buy now, or both (a few big-ticket items suit buy now; a large catalogue a drawer and add to cart). checkout: one page or steps, summary beside or above, note field, heading, a reassurance line under Place order."
            : "",
          "account: shown or not, header or footer, label, display.",
          "display (cart and account): icon for a minimal header, icon_label or label to match a text menu, button for a solid call to action (use sparingly — never both as buttons next to the header's own CTA), pill for a soft outlined chip. The account usually sits quieter than the cart.",
          `pages: the pages outside the site's sections, drawn in its theme. frame: plain, card or tinted. auth (sign in / sign up): layout centered, split or image (with an image from the media library or photo search), heading, intro, perks (up to 4 short reasons to join), signInHeading, signUpHeading. account: heading ("{name}" = first name), ordersHeading, emptyOrders.${store ? " cart: heading, empty (an empty cart in the brand's voice), continueLabel. thanks: heading and message after an order (\"{name}\" works)." : ""} Write them in the site's voice.`,
        ]
          .filter(Boolean)
          .join(" "),
        inputSchema: z.object({
          cart: z
            .object({ style: z.enum(["drawer", "page"]), icon: z.enum(["bag", "cart", "basket"]), placement: z.enum(["nav", "floating"]), label: words(20), display })
            .partial()
            .optional(),
          buy: z.enum(["add_to_cart", "buy_now", "both"]).optional(),
          checkout: z
            .object({ layout: z.enum(["single", "steps"]), summary: z.enum(["side", "top"]), askNote: z.boolean(), heading: words(80), reassurance: words(200) })
            .partial()
            .optional(),
          account: z.object({ show: z.boolean(), placement: z.enum(["nav", "footer"]), label: words(20), display }).partial().optional(),
          pages: z
            .object({
              frame: z.enum(["plain", "card", "tinted"]),
              auth: z
                .object({
                  layout: z.enum(["centered", "split", "image"]),
                  heading: words(80),
                  intro: words(200),
                  image: z.string().max(500),
                  perks: z.array(words(60)).max(4),
                  signInHeading: words(40),
                  signUpHeading: words(40),
                })
                .partial(),
              account: z.object({ heading: words(60), ordersHeading: words(40), emptyOrders: words(120) }).partial(),
              cart: z.object({ heading: words(40), empty: words(120), continueLabel: words(30) }).partial(),
              thanks: z.object({ heading: words(60), message: words(200) }).partial(),
            })
            .partial()
            .optional(),
        }),
        run: (i) => {
          if (!store && (i.cart || i.buy || i.checkout || i.pages?.cart || i.pages?.thanks)) {
            throw new ToolInputError("This site sells nothing, so it has no cart, checkout or order pages — only the account settings apply.");
          }
          checkNoHtml(i, "commerce");
          return apply({ op: "setCommerce", commerce: i });
        },
      }),
    );
  }

  if (caps.dataTools !== false) tools.push(
    siteTool({
      name: "view_data",
      description: "Return the site's data collections (profile, projects, experience…) with entry ids, including changes made so far in this turn.",
      inputSchema: z.object({ collection: collection.optional() }),
      run: (i) => JSON.stringify(i.collection ? { [i.collection]: state.data[i.collection] ?? [] } : state.data),
    }),
    siteTool({
      name: "add_entry",
      description:
        "Add an entry to a data collection (a project, a job, a skill…). For the profile (one record) this sets it. Fields must match the collection's fields. Shown wherever a collection section for it is on the site.",
      inputSchema: z.object({ collection, item: z.record(z.string(), z.unknown()), index: z.number().int().min(0).optional() }),
      run: (i) => dataOp({ op: "addItem", collection: i.collection, item: i.item, ...(i.index !== undefined ? { index: i.index } : {}) }),
    }),
    siteTool({
      name: "update_entry",
      description:
        "Change fields of an existing entry (by id; the profile needs no id). Filling an empty field applies at once; changing a field that already has a value is kept as a proposal the owner must allow.",
      inputSchema: z.object({ collection, id: z.string().optional(), fields: z.record(z.string(), z.unknown()) }),
      run: (i) => dataOp({ op: "updateItem", collection: i.collection, id: i.id, fields: i.fields }),
    }),
    siteTool({
      name: "remove_entry",
      description: "Remove an entry. The owner is asked before anything is removed.",
      inputSchema: z.object({ collection, id: z.string().optional() }),
      run: (i) => dataOp({ op: "removeItem", collection: i.collection, id: i.id }),
    }),
    siteTool({
      name: "move_entry",
      description: "Move an entry to a position in its collection (0 = first).",
      inputSchema: z.object({ collection, id: z.string(), index: z.number().int().min(0) }),
      run: (i) => dataOp({ op: "moveItem", collection: i.collection, id: i.id, index: i.index }),
    }),
  );

  if (caps.importImage) {
    const importImage = caps.importImage;
    let saved = 0;
    tools.push(
      siteTool({
        name: "save_image",
        description:
          "Copy an illustration or icon into the site's media library and get a permanent https URL to put in image fields. Use it for Icons8 illustrations (their download links expire within the hour) and SVGs an asset tool returned. Never for Unsplash photos — use their URL exactly as search_photos gave it.",
        inputSchema: z.object({
          url: z.string().optional().describe("The asset service's download link"),
          svg: z.string().optional().describe("SVG markup an asset tool returned"),
          alt: z.string().max(300).describe("What the picture shows, for people who cannot see it"),
        }),
        run: async (i) => {
          if (!i.url && !i.svg) throw new ToolInputError("Give the download url or the svg.");
          if (++saved > 12) throw new ToolInputError("That is enough pictures for one edit; reuse ones already saved.");
          try {
            const r = await importImage({ url: i.url, svg: i.svg, alt: i.alt });
            return JSON.stringify({ ok: true, url: r.url });
          } catch (e) {
            throw new ToolInputError((e as Error).message);
          }
        },
      }),
    );
  }

  if (caps.generateImage) {
    const generate = caps.generateImage;
    const max = caps.maxImages ?? 4;
    tools.push(
      siteTool({
        name: "generate_image",
        description: `Create a new picture (photo or illustration) for this site and get its URL, then put that URL in a hero, imageText or gallery image field. Use it when the site needs a picture and none was given. At most ${max} per request, so spend them on the pictures that matter most (the hero first). Describe the subject, setting, light and mood concretely; never ask for text, logos or real people's faces in the picture.`,
        inputSchema: z.object({
          prompt: z.string().min(10).max(900).describe("What the picture shows, concretely"),
          aspect: z.enum(["wide", "landscape", "square", "portrait"]).default("landscape").describe("wide for a hero, landscape for image+text, square for galleries"),
          style: z.enum(["photo", "illustration", "3d", "flat"]).default("photo"),
        }),
        run: async (i) => {
          // One refusal (no access, no quota) will not change on a retry: say so once and
          // steer the model back to the rest of the request instead of burning attempts.
          if (state.imageError) {
            throw new ToolInputError(`Picture generation is unavailable (${state.imageError}). Do not call generate_image again; leave image fields empty and finish the rest of the request.`);
          }
          if (state.images >= max) throw new ToolInputError(`The limit of ${max} new pictures for this request is reached. Reuse one of the URLs you already have.`);
          const palette = caps.imagePalette?.length ? ` Colour palette: ${caps.imagePalette.join(", ")}.` : "";
          try {
            const image = await generate({ prompt: `${i.prompt}${palette}`, aspect: i.aspect, style: i.style });
            state.images++; // only pictures actually made count against the limit
            return JSON.stringify({ ok: true, ...image });
          } catch (e) {
            state.imageError = (e as Error).message;
            throw new ToolInputError(`Picture generation failed: ${state.imageError} Do not retry; leave image fields empty and carry on with every other part of the request.`);
          }
        },
      }),
    );
  }

  if (caps.fetchReference) {
    const fetchRef = caps.fetchReference;
    const max = caps.maxReferences ?? 3;
    tools.push(
      siteTool({
        name: "fetch_reference",
        description: `Look at a website the user pointed to as a reference: returns its title, headings, navigation, section outline, colours, fonts and some text. Use it when the request names a URL. Take structure, tone and palette as inspiration; never copy its text word for word, and never use its images or brand name. At most ${max} per request.`,
        inputSchema: z.object({ url: z.string().url().describe("The full http(s) address") }),
        run: async (i) => {
          if (state.references >= max) throw new ToolInputError(`The limit of ${max} reference sites for this request is reached.`);
          state.references++;
          return JSON.stringify(await fetchRef(i.url));
        },
      }),
    );
  }

  return { tools, state };
}
