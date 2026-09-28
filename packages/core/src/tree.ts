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
  /**
   * How much the page moves: sections easing in as they scroll into view,
   * the hero arriving, cards lifting under the pointer. Optional so trees
   * saved before it existed stay byte-identical; absent reads as "subtle".
   * Visitors who ask their device for reduced motion get none, whatever this says.
   */
  motion: z.enum(["none", "subtle", "lively"]).optional(),
});
export const MOTIONS = ["none", "subtle", "lively"] as const;
export type Theme = z.infer<typeof Theme>;

export const Link = z.object({ label: Text(60), href: Href });

/**
 * How a store's cart, checkout and customer account look and where they sit.
 * The AI decides these for the site like any other design choice; everything
 * has a default, so a store that never set them still sells.
 */
export const Commerce = z.object({
  cart: z
    .object({
      style: z.enum(["drawer", "page"]).default("drawer").describe("drawer: slides over the page; page: its own /cart page"),
      icon: z.enum(["bag", "cart", "basket"]).default("bag"),
      placement: z
        .enum(["nav", "floating"])
        .default("nav")
        .describe("nav: in the header; floating: a round button fixed to the bottom corner — good for long, image-led mobile pages"),
      label: Text(20).optional().describe('Word beside the icon, e.g. "Bag"; omit for the icon alone'),
    })
    .default({ style: "drawer", icon: "bag", placement: "nav" }),
  buy: z
    .enum(["add_to_cart", "buy_now", "both"])
    .default("both")
    .describe("Buttons on a product: add to cart and keep shopping, go straight to checkout, or both"),
  checkout: z
    .object({
      layout: z.enum(["single", "steps"]).default("single").describe("single: one page; steps: contact → address → review"),
      summary: z.enum(["side", "top"]).default("side").describe("Where the order summary sits on wide screens"),
      askNote: z.boolean().default(true).describe("Offer a note field (delivery instructions)"),
      heading: Text(80).optional(),
      reassurance: Text(200).optional().describe("One line under the Place order button: delivery promise, returns, support"),
    })
    .default({ layout: "single", summary: "side", askNote: true }),
  account: z
    .object({
      show: z.boolean().default(true).describe("Let customers sign in to see their orders"),
      placement: z.enum(["nav", "footer"]).default("nav"),
      label: Text(20).default("Account"),
    })
    .default({ show: true, placement: "nav", label: "Account" }),
});
export type Commerce = z.infer<typeof Commerce>;
export const DEFAULT_COMMERCE: Commerce = Commerce.parse({});
export type Link = z.infer<typeof Link>;

// ---------------------------------------------------------------------------
// Blocks. Every block's props schema is also the AI tool's input schema, so
// the descriptions below are read by the model — keep them about *what the
// block is for*, not how it is drawn.
// ---------------------------------------------------------------------------

/** The data collections a `collection` section can show (defined in data.ts). */
/**
 * An icon: a Lucide name ("truck", "shield-check" — search_icons finds them)
 * or the https address of an icon picture from an icon service.
 */
export const IconRef = z
  .string()
  .max(300)
  .refine((v) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) || /^https:\/\//i.test(v), 'an icon is a Lucide name like "truck" or an https URL');

/**
 * How one section looks, beyond its block: background, texture, the shape of
 * its lower edge, its breathing room and how its content enters. Optional so
 * trees saved before it existed are unchanged; absent reads as plain.
 */
export const SectionStyle = z
  .object({
    background: z
      .enum(["default", "surface", "primary", "dark", "gradient", "mesh", "image"])
      .describe("default: page colour; surface: panel colour; primary: brand colour; dark: deep, inverted; gradient: primary into accent; mesh: soft colour glows; image: the picture below, darkened for legible text"),
    image: ImageUrl.describe("Background picture, for background: image"),
    pattern: z.enum(["none", "dots", "grid", "noise"]).describe("A faint texture over the background"),
    divider: z.enum(["none", "wave", "slant", "curve"]).describe("Shape of the section's bottom edge, flowing into the next"),
    spacing: z.enum(["compact", "normal", "roomy"]),
    animation: z
      .enum(["auto", "rise", "fade", "zoom", "slide", "blur", "none"])
      .describe("How its content enters as it scrolls into view; auto follows the theme's motion"),
  })
  .partial();
export type SectionStyle = z.infer<typeof SectionStyle>;

export const DATA_COLLECTION_KEYS = [
  "profile", "projects", "experience", "education", "skills", "services",
  "testimonials", "awards", "publications", "clients", "gallery",
] as const;

export const BLOCKS = {
  hero: z.object({
    eyebrow: Text(80).optional().describe("Small line above the heading"),
    heading: Text(140),
    subheading: Text(400).optional(),
    primaryCta: Link.optional(),
    secondaryCta: Link.optional(),
    image: ImageUrl.optional(),
    align: z.enum(["left", "center"]).default("center"),
    layout: z
      .enum(["classic", "split", "fullbleed", "stacked"])
      .optional()
      .describe("classic: copy with the picture beside it when there is one; split: half copy, half picture edge to edge; fullbleed: the picture fills the hero behind the copy; stacked: big centred copy with a wide picture below"),
    backdrop: z.enum(["glow", "mesh", "grid", "spotlight", "none"]).optional().describe("Decoration behind the copy (default glow)"),
    highlight: Text(60).optional().describe("Words from the heading, copied exactly, to paint in the brand gradient"),
    rotating: z.array(Text(30)).max(5).optional().describe("Words that take turns after the heading: ['cakes', 'flowers', 'smiles']"),
    badges: z.array(Text(40)).max(4).optional().describe("Small proof chips under the buttons: '4.9★ on Google', 'Since 1998'"),
  }),
  features: z.object({
    heading: Text(140),
    subheading: Text(400).optional(),
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
    layout: z
      .enum(["cards", "bento", "icons", "list"])
      .optional()
      .describe("cards: equal cards; bento: a mosaic where the first item is large; icons: open icon + text, no boxes; list: a two-column checklist"),
    items: z
      .array(z.object({ title: Text(80), body: Text(400), icon: IconRef.optional() }))
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
    eyebrow: Text(60).optional(),
    bullets: z.array(z.object({ text: Text(120), icon: IconRef.optional() })).max(6).optional().describe("Short points with icons under the body"),
    badge: Text(40).optional().describe("A floating label on the picture: 'Handmade in Patna'"),
  }),
  gallery: z.object({
    heading: Text(140).optional(),
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
    layout: z.enum(["grid", "masonry", "carousel"]).optional().describe("carousel scrolls sideways with snap"),
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
    layout: z.enum(["cards", "marquee", "spotlight"]).optional().describe("marquee: an endless scrolling row; spotlight: one big quote first"),
    items: z
      .array(z.object({ quote: Text(600), author: Text(80), role: Text(80).optional(), rating: z.number().int().min(1).max(5).optional() }))
      .min(1)
      .max(12),
  }),
  stats: z.object({
    heading: Text(140).optional(),
    items: z
      .array(z.object({ value: Text(20).describe("Counts up when it starts with a number: '12,000+', '4.9★', '25 yrs'"), label: Text(60), icon: IconRef.optional() }))
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
    secondary: Link.optional(),
    style: z.enum(["banner", "glow", "split", "minimal"]).optional().describe("banner: a solid brand panel; glow: dark panel with moving colour; split: text left, buttons right; minimal: no panel"),
  }),
  logos: z.object({
    heading: Text(140).optional().describe("e.g. 'Trusted by 300+ Patna businesses'"),
    items: z
      .array(z.object({ name: Text(60), image: ImageUrl.optional(), href: Href.optional() }))
      .min(2)
      .max(24)
      .describe("Clients, partners, brands stocked or press; names are shown as wordmarks when there is no logo image"),
    marquee: z.boolean().default(true).describe("Scroll endlessly instead of a still row"),
  }),
  marquee: z.object({
    items: z.array(Text(40)).min(2).max(16).describe("Short phrases in a moving band: 'Free delivery', 'Handmade', 'Since 1998'"),
    icon: IconRef.optional().describe("Separator between phrases"),
    speed: z.enum(["slow", "normal", "fast"]).default("normal"),
    tone: z.enum(["primary", "dark", "outline"]).default("primary"),
  }),
  steps: z.object({
    heading: Text(140),
    subheading: Text(400).optional(),
    layout: z.enum(["timeline", "cards"]).default("cards"),
    items: z
      .array(z.object({ title: Text(80), body: Text(300), icon: IconRef.optional() }))
      .min(2)
      .max(6)
      .describe("How it works, in order"),
  }),
  collection: z.object({
    collection: z.enum(DATA_COLLECTION_KEYS).describe("Which data collection this section shows; its entries are edited as data, not here"),
    heading: Text(140).optional(),
    subheading: Text(400).optional(),
    layout: z
      .enum(["cards", "grid", "list", "timeline", "chips", "about"])
      .optional()
      .describe("cards/grid for projects, clients, gallery; timeline for experience, education; chips for skills; about for the profile; list for awards, publications"),
    limit: z.number().int().min(1).max(60).optional(),
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
  z.object({ id: z.string().min(1).max(40), type: z.literal(type), props: BLOCKS[type], style: SectionStyle.optional() });

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
  sectionOf("logos"),
  sectionOf("marquee"),
  sectionOf("steps"),
  sectionOf("collection"),
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
      /** The business's logo, drawn beside the brand name. Set from the brand kit, never by the AI. */
      logo: ImageUrl.optional(),
      links: z.array(Link).max(8),
      cta: Link.optional(),
    }),
    footer: z.object({
      text: Text(300),
      links: z.array(Link).max(12),
    }),
    pages: z.array(Page).min(1).max(30),
    /** Stores only: cart, checkout and account presentation. Absent reads as DEFAULT_COMMERCE. */
    commerce: Commerce.optional(),
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
