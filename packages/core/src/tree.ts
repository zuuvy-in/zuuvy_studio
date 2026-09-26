/**
 * The site tree — what a website *is* on this platform.
 *
 * A site is data, not code: pages hold sections, each section is one block
 * from the runtime's component library with its props. The AI edits this tree
 * through operations (`ops.ts`), every version is a snapshot of it, and a
 * template is a tree someone saved. That is what makes non-destructive AI
 * edits, diffs, templates and runtime upgrades possible at all — free-form
 * generated code offers none of them. Sites that need free-form code are
 * ejected to git and become `code` versions instead (see docs/ARCHITECTURE.md).
 *
 * `SCHEMA_VERSION` is the shape of this tree, not the platform's release. A
 * runtime upgrade that changes it ships a migration in `migrate.ts`.
 */
import { z } from "zod";

export const SCHEMA_VERSION = 1;

const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "a colour is #rrggbb");

/**
 * A link target: a path on this site, an anchor, or an absolute http(s),
 * mailto:, tel: or WhatsApp link. `javascript:` and friends are refused here
 * so no tree — AI-written or imported — can carry script into a page.
 */
export const Href = z
  .string()
  .max(500)
  .refine(
    (v) =>
      v.startsWith("/") ||
      v.startsWith("#") ||
      /^https?:\/\//i.test(v) ||
      /^mailto:/i.test(v) ||
      /^tel:/i.test(v),
    "a link is a /path, #anchor, http(s)://, mailto: or tel: address",
  );

/** An image is an absolute https URL. Missing images render as a placeholder. */
export const ImageUrl = z
  .string()
  .max(1000)
  .refine((v) => /^https:\/\//i.test(v), "an image is an https:// URL");

const Text = (max: number) => z.string().max(max);

export const FONTS = [
  "Inter",
  "Manrope",
  "DM Sans",
  "Poppins",
  "Playfair Display",
  "Lora",
  "Space Grotesk",
  "Outfit",
] as const;

export const Theme = z.object({
  colors: z.object({
    primary: hex,
    background: hex,
    surface: hex,
    text: hex,
    muted: hex,
    accent: hex,
  }),
  fonts: z.object({
    heading: z.enum(FONTS),
    body: z.enum(FONTS),
  }),
  radius: z.enum(["none", "sm", "md", "lg", "full"]),
});
export type Theme = z.infer<typeof Theme>;

export const Link = z.object({ label: Text(60), href: Href });
export type Link = z.infer<typeof Link>;

// ---------------------------------------------------------------------------
// Blocks. Every block's props schema is also the AI tool's input schema, so
// the descriptions below are read by the model — keep them about *what the
// block is for*, not how it is drawn.
// ---------------------------------------------------------------------------

export const BLOCKS = {
  hero: z.object({
    eyebrow: Text(80).optional().describe("Small line above the heading"),
    heading: Text(140),
    subheading: Text(400).optional(),
    primaryCta: Link.optional(),
    secondaryCta: Link.optional(),
    image: ImageUrl.optional(),
    align: z.enum(["left", "center"]).default("center"),
  }),
  features: z.object({
    heading: Text(140),
    subheading: Text(400).optional(),
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
    items: z
      .array(z.object({ title: Text(80), body: Text(400) }))
      .min(1)
      .max(12),
  }),
  productGrid: z.object({
    heading: Text(140),
    subheading: Text(400).optional(),
    category: Text(80)
      .optional()
      .describe("Only products in this category; omit for all"),
    limit: z.number().int().min(1).max(48).default(12),
    sort: z.enum(["name", "price_asc", "price_desc", "newest"]).default("name"),
    showPrices: z.boolean().default(true),
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
  }),
  richText: z.object({
    heading: Text(140).optional(),
    body: Text(6000).describe("Plain text; blank lines separate paragraphs"),
  }),
  imageText: z.object({
    heading: Text(140),
    body: Text(2000),
    image: ImageUrl.optional(),
    imageSide: z.enum(["left", "right"]).default("right"),
    cta: Link.optional(),
  }),
  gallery: z.object({
    heading: Text(140).optional(),
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
    items: z
      .array(
        z.object({
          image: ImageUrl.optional(),
          title: Text(100),
          caption: Text(300).optional(),
          href: Href.optional(),
        }),
      )
      .min(1)
      .max(24),
  }),
  testimonials: z.object({
    heading: Text(140),
    items: z
      .array(z.object({ quote: Text(600), author: Text(80), role: Text(80).optional() }))
      .min(1)
      .max(9),
  }),
  stats: z.object({
    items: z
      .array(z.object({ value: Text(20), label: Text(60) }))
      .min(1)
      .max(6),
  }),
  faq: z.object({
    heading: Text(140),
    items: z
      .array(z.object({ question: Text(200), answer: Text(1500) }))
      .min(1)
      .max(20),
  }),
  cta: z.object({
    heading: Text(140),
    body: Text(400).optional(),
    button: Link,
  }),
  contact: z.object({
    heading: Text(140),
    body: Text(600).optional(),
    email: z.email().optional(),
    phone: Text(20).optional(),
    whatsapp: Text(20).optional().describe("Number for a wa.me chat link"),
    address: Text(300).optional(),
  }),
} as const;

export type BlockType = keyof typeof BLOCKS;
export const BLOCK_TYPES = Object.keys(BLOCKS) as BlockType[];

export type BlockProps<T extends BlockType> = z.infer<(typeof BLOCKS)[T]>;

const sectionOf = <T extends BlockType>(type: T) =>
  z.object({ id: z.string().min(1).max(40), type: z.literal(type), props: BLOCKS[type] });

export const Section = z.discriminatedUnion("type", [
  sectionOf("hero"),
  sectionOf("features"),
  sectionOf("productGrid"),
  sectionOf("richText"),
  sectionOf("imageText"),
  sectionOf("gallery"),
  sectionOf("testimonials"),
  sectionOf("stats"),
  sectionOf("faq"),
  sectionOf("cta"),
  sectionOf("contact"),
]);
export type Section = z.infer<typeof Section>;

export const PagePath = z
  .string()
  .max(80)
  .regex(/^\/([a-z0-9-]+(\/[a-z0-9-]+)*)?$/, "a page path is / or /lowercase-words");

export const Page = z.object({
  id: z.string().min(1).max(40),
  path: PagePath,
  title: Text(100),
  sections: z.array(Section).max(40),
});
export type Page = z.infer<typeof Page>;

export const SiteTree = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    meta: z.object({
      title: Text(100),
      description: Text(300),
    }),
    theme: Theme,
    nav: z.object({
      brand: Text(60),
      links: z.array(Link).max(8),
      cta: Link.optional(),
    }),
    footer: z.object({
      text: Text(300),
      links: z.array(Link).max(12),
    }),
    pages: z.array(Page).min(1).max(30),
  })
  .superRefine((tree, ctx) => {
    const paths = new Set<string>();
    const ids = new Set<string>();
    if (!tree.pages.some((p) => p.path === "/")) {
      ctx.addIssue({ code: "custom", message: "a site needs a home page at /", path: ["pages"] });
    }
    tree.pages.forEach((page, i) => {
      if (paths.has(page.path)) {
        ctx.addIssue({ code: "custom", message: `two pages at ${page.path}`, path: ["pages", i, "path"] });
      }
      paths.add(page.path);
      for (const id of [page.id, ...page.sections.map((s) => s.id)]) {
        if (ids.has(id)) {
          ctx.addIssue({ code: "custom", message: `id ${id} is used twice`, path: ["pages", i] });
        }
        ids.add(id);
      }
    });
  });
export type SiteTree = z.infer<typeof SiteTree>;

/** Parse and normalise (defaults filled) — throws a readable error. */
export function parseTree(input: unknown): SiteTree {
  const result = SiteTree.safeParse(input);
  if (!result.success) {
    throw new TreeError(describeIssues(result.error));
  }
  return result.data;
}

export class TreeError extends Error {
  override name = "TreeError";
}

export function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 6)
    .map((i) => `${i.path.join(".") || "(tree)"}: ${i.message}`)
    .join("; ");
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}
