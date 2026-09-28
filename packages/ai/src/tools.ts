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
};

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
  commerceTools?: boolean;
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
  const state: EditState = { tree: initial, operations: [], images: 0, references: 0, data: initialData, dataOperations: [], proposals: [] };
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
        after: z.string().optional().describe("Insert after this section id; omit to append"),
        index: z.number().int().min(0).optional().describe("Insert at this position (0 = top); ignored when `after` is given"),
      }),
      run: (i) => {
        if (i.type === "collection" && caps.dataTools === false) {
          throw new ToolInputError("Collection sections are for portfolio sites. Use features, gallery, testimonials or other blocks here.");
        }
        const before = new Set(state.tree.pages.flatMap((p) => p.sections.map((s) => s.id)));
        return apply(
          { op: "addSection", page: i.page, type: i.type as BlockType, props: i.props, ...(i.after ? { after: i.after } : {}), ...(i.index !== undefined ? { index: i.index } : {}) },
          (tree) => ({ section: tree.pages.flatMap((p) => p.sections).find((s) => !before.has(s.id))?.id }),
        );
      },
    }),
    siteTool({
      name: "update_section",
      description:
        "Change some props of a section. Send only the fields to change; arrays (items) are replaced whole. Send null to clear an optional field.",
      inputSchema: z.object({ section: z.string(), props: z.record(z.string(), z.unknown()) }),
      run: (i) => apply({ op: "updateSection", section: i.section, props: i.props }),
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

  if (caps.commerceTools) tools.push(
    siteTool({
      name: "set_commerce",
      description:
        "Decide how this store sells: the cart (drawer or page, icon, in the header or a floating button, optional label), the product buttons (add to cart, buy now, both), the checkout (one page or steps, summary beside or above, note field, heading, a reassurance line under Place order) and the customer account link (shown or not, header or footer, label). Send only what changes. Fit it to the store: a few big-ticket items suit buy now and a one-page checkout; a large catalogue suits a cart drawer and add to cart.",
      inputSchema: z.object({
        cart: z.object({ style: z.enum(["drawer", "page"]), icon: z.enum(["bag", "cart", "basket"]), placement: z.enum(["nav", "floating"]), label: z.string().max(20) }).partial().optional(),
        buy: z.enum(["add_to_cart", "buy_now", "both"]).optional(),
        checkout: z
          .object({ layout: z.enum(["single", "steps"]), summary: z.enum(["side", "top"]), askNote: z.boolean(), heading: z.string().max(80), reassurance: z.string().max(200) })
          .partial()
          .optional(),
        account: z.object({ show: z.boolean(), placement: z.enum(["nav", "footer"]), label: z.string().max(20) }).partial().optional(),
      }),
      run: (i) => apply({ op: "setCommerce", commerce: i }),
    }),
  );

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
