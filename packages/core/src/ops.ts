/**
 * Operations on a site tree. The only way anything — the AI, a template, the
 * dashboard — changes a site.
 *
 * Each operation is pure: it takes a tree and returns a new one, validated in
 * full, or throws `OpError` in words the AI can act on ("no section s_12 on
 * page /about"). A batch either applies completely or not at all, so a prompt
 * that fails halfway never becomes a half-edited version.
 */
import { z } from "zod";
import {
  BLOCKS,
  type BlockType,
  Link,
  PagePath,
  type SiteTree,
  SiteTree as SiteTreeSchema,
  Theme,
  describeIssues,
  newId,
  Commerce,
  DEFAULT_COMMERCE,
  SectionStyle,
} from "./tree";

export class OpError extends Error {
  override name = "OpError";
}

const DeepPartialTheme = z.object({
  colors: Theme.shape.colors.partial().optional(),
  fonts: Theme.shape.fonts.partial().optional(),
  radius: Theme.shape.radius.optional(),
  motion: Theme.shape.motion,
  iconPack: Theme.shape.iconPack,
  illustrationStyle: Theme.shape.illustrationStyle,
});

export const Operation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("setTheme"), theme: DeepPartialTheme }),
  z.object({
    op: z.literal("setCommerce"),
    commerce: z.object({
      cart: Commerce.shape.cart.unwrap().partial().optional(),
      buy: Commerce.shape.buy.unwrap().optional(),
      checkout: Commerce.shape.checkout.unwrap().partial().optional(),
      account: Commerce.shape.account.unwrap().partial().optional(),
    }),
  }),
  z.object({
    op: z.literal("setMeta"),
    title: z.string().max(100).optional(),
    description: z.string().max(300).optional(),
  }),
  z.object({
    op: z.literal("setNav"),
    brand: z.string().max(60).optional(),
    links: z.array(Link).max(8).optional(),
    cta: Link.nullable().optional(),
  }),
  z.object({
    op: z.literal("setFooter"),
    text: z.string().max(300).optional(),
    links: z.array(Link).max(12).optional(),
  }),
  z.object({
    op: z.literal("addPage"),
    path: PagePath,
    title: z.string().max(100),
  }),
  z.object({
    op: z.literal("updatePage"),
    page: z.string(),
    path: PagePath.optional(),
    title: z.string().max(100).optional(),
  }),
  z.object({ op: z.literal("removePage"), page: z.string() }),
  z.object({
    op: z.literal("addSection"),
    page: z.string(),
    type: z.enum(Object.keys(BLOCKS) as [BlockType, ...BlockType[]]),
    props: z.record(z.string(), z.unknown()),
    after: z.string().optional(),
    index: z.number().int().min(0).optional(),
  }),
  z.object({
    op: z.literal("updateSection"),
    section: z.string(),
    props: z.record(z.string(), z.unknown()),
  }),
  z.object({ op: z.literal("removeSection"), section: z.string() }),
  z.object({
    op: z.literal("styleSection"),
    section: z.string(),
    /** Fields to set; null clears one; an empty object clears them all. */
    style: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal("moveSection"),
    section: z.string(),
    index: z.number().int().min(0),
  }),
]);
export type Operation = z.infer<typeof Operation>;

/** A page is named by its id or its path — the AI naturally says "/about". */
function findPage(tree: SiteTree, ref: string) {
  const page = tree.pages.find((p) => p.id === ref || p.path === ref);
  if (!page) {
    const known = tree.pages.map((p) => p.path).join(", ");
    throw new OpError(`no page ${ref}; pages are ${known}`);
  }
  return page;
}

function findSection(tree: SiteTree, id: string) {
  for (const page of tree.pages) {
    const index = page.sections.findIndex((s) => s.id === id);
    if (index >= 0) return { page, index, section: page.sections[index]! };
  }
  throw new OpError(`no section ${id}`);
}

function blockProps(type: BlockType, props: unknown) {
  const result = BLOCKS[type].safeParse(props);
  if (!result.success) {
    throw new OpError(`${type} props: ${describeIssues(result.error)}`);
  }
  return result.data;
}

function applyOne(tree: SiteTree, raw: Operation): void {
  const op = Operation.parse(raw);
  switch (op.op) {
    case "setTheme":
      tree.theme = {
        colors: { ...tree.theme.colors, ...op.theme.colors },
        fonts: { ...tree.theme.fonts, ...op.theme.fonts },
        radius: op.theme.radius ?? tree.theme.radius,
        ...((op.theme.motion ?? tree.theme.motion) ? { motion: op.theme.motion ?? tree.theme.motion } : {}),
        ...((op.theme.iconPack ?? tree.theme.iconPack) ? { iconPack: op.theme.iconPack ?? tree.theme.iconPack } : {}),
        ...((op.theme.illustrationStyle ?? tree.theme.illustrationStyle) ? { illustrationStyle: op.theme.illustrationStyle ?? tree.theme.illustrationStyle } : {}),
      };
      return;
    case "setCommerce": {
      const now = tree.commerce ?? DEFAULT_COMMERCE;
      tree.commerce = Commerce.parse({
        cart: { ...now.cart, ...op.commerce.cart },
        buy: op.commerce.buy ?? now.buy,
        checkout: { ...now.checkout, ...op.commerce.checkout },
        account: { ...now.account, ...op.commerce.account },
      });
      return;
    }
    case "setMeta":
      if (op.title !== undefined) tree.meta.title = op.title;
      if (op.description !== undefined) tree.meta.description = op.description;
      return;
    case "setNav":
      if (op.brand !== undefined) tree.nav.brand = op.brand;
      if (op.links !== undefined) tree.nav.links = op.links;
      if (op.cta === null) delete tree.nav.cta;
      else if (op.cta !== undefined) tree.nav.cta = op.cta;
      return;
    case "setFooter":
      if (op.text !== undefined) tree.footer.text = op.text;
      if (op.links !== undefined) tree.footer.links = op.links;
      return;
    case "addPage":
      if (tree.pages.some((p) => p.path === op.path)) {
        throw new OpError(`a page already exists at ${op.path}`);
      }
      tree.pages.push({ id: newId("p"), path: op.path, title: op.title, sections: [] });
      return;
    case "updatePage": {
      const page = findPage(tree, op.page);
      if (op.path !== undefined) {
        if (page.path === "/" && op.path !== "/") throw new OpError("the home page stays at /");
        page.path = op.path;
      }
      if (op.title !== undefined) page.title = op.title;
      return;
    }
    case "removePage": {
      const page = findPage(tree, op.page);
      if (page.path === "/") throw new OpError("the home page cannot be removed");
      tree.pages = tree.pages.filter((p) => p !== page);
      return;
    }
    case "addSection": {
      const page = findPage(tree, op.page);
      const section = { id: newId("s"), type: op.type, props: blockProps(op.type, op.props) };
      let at = page.sections.length;
      if (op.after !== undefined) {
        const i = page.sections.findIndex((s) => s.id === op.after);
        if (i < 0) throw new OpError(`no section ${op.after} on ${page.path}`);
        at = i + 1;
      } else if (op.index !== undefined) {
        at = Math.min(op.index, page.sections.length);
      }
      page.sections.splice(at, 0, section as SiteTree["pages"][number]["sections"][number]);
      return;
    }
    case "updateSection": {
      const { section } = findSection(tree, op.section);
      // Shallow merge: the AI sends the fields it means to change. Arrays
      // (feature items, FAQ entries) are replaced whole, which is what
      // "rewrite the FAQ" means.
      const merged = { ...section.props, ...op.props };
      for (const [k, v] of Object.entries(op.props)) {
        if (v === null) delete (merged as Record<string, unknown>)[k];
      }
      (section as { props: unknown }).props = blockProps(section.type, merged);
      return;
    }
    case "styleSection": {
      const { section } = findSection(tree, op.section);
      const next: Record<string, unknown> = Object.keys(op.style).length ? { ...(section.style ?? {}), ...op.style } : {};
      for (const [k, v] of Object.entries(op.style)) if (v === null) delete next[k];
      const parsed = SectionStyle.safeParse(next);
      if (!parsed.success) throw new OpError(`section style: ${describeIssues(parsed.error)}`);
      if (parsed.data.background === "image" && !parsed.data.image) throw new OpError("section style: background image needs an image URL");
      if (Object.keys(parsed.data).length) section.style = parsed.data;
      else delete section.style;
      return;
    }
    case "removeSection": {
      const { page, index } = findSection(tree, op.section);
      page.sections.splice(index, 1);
      return;
    }
    case "moveSection": {
      const { page, index, section } = findSection(tree, op.section);
      page.sections.splice(index, 1);
      page.sections.splice(Math.min(op.index, page.sections.length), 0, section);
      return;
    }
  }
}

/** Apply a batch atomically. The input tree is never mutated. */
export function applyOps(tree: SiteTree, ops: Operation[]): SiteTree {
  const next = structuredClone(tree);
  ops.forEach((op, i) => {
    try {
      applyOne(next, op);
    } catch (e) {
      if (e instanceof z.ZodError) throw new OpError(`operation ${i + 1}: ${describeIssues(e)}`);
      if (e instanceof OpError) throw new OpError(`operation ${i + 1} (${op.op}): ${e.message}`);
      throw e;
    }
  });
  const result = SiteTreeSchema.safeParse(next);
  if (!result.success) throw new OpError(describeIssues(result.error));
  return result.data;
}

