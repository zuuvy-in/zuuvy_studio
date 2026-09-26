/**
 * The agent's tools: one per site-tree operation, plus a way to look at the
 * site as it stands mid-edit. Every call goes through `applyOps`, so the model
 * cannot produce a tree the runtime would refuse — an invalid call comes back
 * as a tool error in words it can correct ("hero props: heading: Required").
 */
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { BLOCK_TYPES, type BlockType, FONTS, type Operation, type SiteTree, applyOps } from "@zsite/core";
import { z } from "zod";

export type EditState = { tree: SiteTree; operations: Operation[] };

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

export function createSiteTools(initial: SiteTree) {
  const state: EditState = { tree: initial, operations: [] };

  const apply = (op: Operation, result: (tree: SiteTree) => Record<string, unknown> = () => ({})) => {
    // applyOps throws OpError with a readable message; the tool runner turns a
    // throw into an is_error tool result, which is what we want.
    const next = applyOps(state.tree, [op]);
    state.tree = next;
    state.operations.push(op);
    return JSON.stringify({ ok: true, ...result(next) });
  };

  const tools = [
    betaZodTool({
      name: "view_site",
      description:
        "Return the full current site tree as JSON, including edits made so far in this turn. Use it when you need exact props before changing a section.",
      inputSchema: z.object({}),
      run: () => JSON.stringify(state.tree),
    }),
    betaZodTool({
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
        const before = new Set(state.tree.pages.flatMap((p) => p.sections.map((s) => s.id)));
        return apply(
          { op: "addSection", page: i.page, type: i.type as BlockType, props: i.props, ...(i.after ? { after: i.after } : {}), ...(i.index !== undefined ? { index: i.index } : {}) },
          (tree) => ({ section: tree.pages.flatMap((p) => p.sections).find((s) => !before.has(s.id))?.id }),
        );
      },
    }),
    betaZodTool({
      name: "update_section",
      description:
        "Change some props of a section. Send only the fields to change; arrays (items) are replaced whole. Send null to clear an optional field.",
      inputSchema: z.object({ section: z.string(), props: z.record(z.string(), z.unknown()) }),
      run: (i) => apply({ op: "updateSection", section: i.section, props: i.props }),
    }),
    betaZodTool({
      name: "remove_section",
      description: "Remove a section.",
      inputSchema: z.object({ section: z.string() }),
      run: (i) => apply({ op: "removeSection", section: i.section }),
    }),
    betaZodTool({
      name: "move_section",
      description: "Move a section to a position on its page (0 = top).",
      inputSchema: z.object({ section: z.string(), index: z.number().int().min(0) }),
      run: (i) => apply({ op: "moveSection", section: i.section, index: i.index }),
    }),
    betaZodTool({
      name: "add_page",
      description: "Add an empty page. Add sections to it afterwards, and a nav link if people should find it.",
      inputSchema: z.object({ path: z.string().describe("/lowercase-words"), title: z.string() }),
      run: (i) =>
        apply({ op: "addPage", path: i.path, title: i.title }, (tree) => ({ page: tree.pages.find((p) => p.path === i.path)?.id })),
    }),
    betaZodTool({
      name: "update_page",
      description: "Rename a page or change its path. The home page stays at /.",
      inputSchema: z.object({ page: z.string(), path: z.string().optional(), title: z.string().optional() }),
      run: (i) => apply({ op: "updatePage", page: i.page, ...(i.path ? { path: i.path } : {}), ...(i.title ? { title: i.title } : {}) }),
    }),
    betaZodTool({
      name: "remove_page",
      description: "Remove a page (not the home page). Also remove links to it.",
      inputSchema: z.object({ page: z.string() }),
      run: (i) => apply({ op: "removePage", page: i.page }),
    }),
    betaZodTool({
      name: "set_theme",
      description: `Change colours, fonts or corner radius. Send only what changes. Fonts: ${FONTS.join(", ")}. Keep text readable against background and surface.`,
      inputSchema: z.object({
        colors: z
          .object({ primary: hex, background: hex, surface: hex, text: hex, muted: hex, accent: hex })
          .partial()
          .optional(),
        fonts: z.object({ heading: z.enum(FONTS), body: z.enum(FONTS) }).partial().optional(),
        radius: z.enum(["none", "sm", "md", "lg", "full"]).optional(),
      }),
      run: (i) => apply({ op: "setTheme", theme: i }),
    }),
    betaZodTool({
      name: "set_site_details",
      description: "Set the site's title and description (browser tab and search results).",
      inputSchema: z.object({ title: z.string().optional(), description: z.string().optional() }),
      run: (i) => apply({ op: "setMeta", ...i }),
    }),
    betaZodTool({
      name: "set_navigation",
      description: "Set the header: brand name, links (max 8), and an optional button (null removes it).",
      inputSchema: z.object({
        brand: z.string().optional(),
        links: z.array(LinkInput).optional(),
        cta: LinkInput.nullable().optional(),
      }),
      run: (i) => apply({ op: "setNav", ...i }),
    }),
    betaZodTool({
      name: "set_footer",
      description: "Set the footer text and links.",
      inputSchema: z.object({ text: z.string().optional(), links: z.array(LinkInput).optional() }),
      run: (i) => apply({ op: "setFooter", ...i }),
    }),
  ];

  return { tools, state };
}
