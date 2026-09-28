/**
 * The design kit: an MCP server the site editor always has, for the things a
 * site tree cannot invent well on its own — real photography, a palette that
 * reads, a font pair that suits the business, and a layout recipe to start
 * from. Everything it answers is in the tree's own vocabulary (its six theme
 * colours, its font list, its section types), so the model can use it as is.
 *
 * It is an ordinary MCP server: the editor connects to it in-process, and
 * `npm run mcp:design-kit -w @zsite/ai` serves it over stdio for any other
 * MCP client (Claude Code, Claude Desktop) to try.
 *
 * Photos come from Unsplash (UNSPLASH_ACCESS_KEY) or Pexels (PEXELS_API_KEY).
 * Both hosts are fixed here — nothing the model says becomes a URL we fetch.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FONTS } from "@zsite/core";
import { z } from "zod";
import { isIconName, searchIcons } from "../icons";
import { SKILLS, SKILL_NAMES } from "../skills";

export type DesignKitOptions = {
  unsplashKey?: string;
  pexelsKey?: string;
  fetch?: typeof fetch;
};

type Font = (typeof FONTS)[number];
type Colors = { primary: string; background: string; surface: string; text: string; muted: string; accent: string };

// ---------------------------------------------------------------- colour

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function rgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

function hsl(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return toHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

/** Darken (or lighten, on a dark page) until the colour reads on `bg` at `ratio`. */
function readable(color: string, bg: string, ratio: number): string {
  const [h, s, l0] = hsl(color);
  const darkBg = luminance(bg) < 0.2;
  let l = l0;
  let out = color;
  for (let i = 0; i < 40 && contrast(out, bg) < ratio; i++) {
    l = darkBg ? Math.min(0.97, l + 0.03) : Math.max(0.03, l - 0.03);
    out = fromHsl(h, s, l);
  }
  return out;
}

export type PaletteMood = "light" | "dark" | "warm" | "cool" | "vivid";

/**
 * A full theme palette from one brand colour. Text is AAA on the page, muted
 * text and the primary colour are AA — whatever colour it starts from.
 */
export function paletteFrom(brand: string, mood: PaletteMood = "light"): Colors & { notes: string[] } {
  const base = brand.startsWith("#") ? brand : `#${brand}`;
  const [h, s] = hsl(base);
  const tint = mood === "warm" ? 35 : mood === "cool" ? 215 : h;
  const dark = mood === "dark";
  const background = dark ? fromHsl(tint, Math.min(s, 0.25), 0.07) : fromHsl(tint, Math.min(s, 0.3), mood === "warm" ? 0.97 : 0.985);
  const surface = dark ? fromHsl(tint, Math.min(s, 0.22), 0.12) : fromHsl(tint, Math.min(s, 0.35), 0.94);
  const text = readable(dark ? fromHsl(tint, 0.15, 0.93) : fromHsl(tint, Math.min(s, 0.4), 0.14), background, 7);
  const muted = readable(dark ? fromHsl(tint, 0.1, 0.7) : fromHsl(tint, Math.min(s, 0.2), 0.42), background, 4.5);
  const primary = readable(mood === "vivid" ? fromHsl(h, Math.max(s, 0.75), hsl(base)[2]) : toHex(rgb(base)), background, 4.5);
  // Split-complement: related enough to sit beside the brand colour, different enough to point at things.
  const accent = readable(fromHsl(h + 150, Math.max(0.55, s), dark ? 0.62 : 0.48), background, 3);
  const notes = [
    `text on background ${contrast(text, background)}:1, muted ${contrast(muted, background)}:1, primary ${contrast(primary, background)}:1`,
  ];
  if (primary.toLowerCase() !== toHex(rgb(base)).toLowerCase() && mood !== "vivid") {
    notes.push(`primary adjusted from ${base} so it reads on the page`);
  }
  return { primary, background, surface, text, muted, accent, notes };
}

// ---------------------------------------------------------------- type

export type TypeStyle = "modern" | "friendly" | "elegant" | "editorial" | "technical" | "bold";

const PAIRINGS: Record<TypeStyle, { heading: Font; body: Font; why: string }[]> = {
  modern: [
    { heading: "Manrope", body: "Inter", why: "Clean and even; a safe default for services and SaaS." },
    { heading: "Outfit", body: "DM Sans", why: "Geometric headings, soft body; young brands." },
  ],
  friendly: [
    { heading: "Poppins", body: "DM Sans", why: "Round and warm; cafés, kids, local services." },
    { heading: "Outfit", body: "Inter", why: "Approachable but tidy." },
  ],
  elegant: [
    { heading: "Playfair Display", body: "Lora", why: "High-contrast serif; salons, jewellery, weddings, hotels." },
    { heading: "Playfair Display", body: "Inter", why: "Luxury headline over a quiet sans body." },
  ],
  editorial: [
    { heading: "Lora", body: "Inter", why: "Book-like headings for writers, studios, portfolios." },
    { heading: "Playfair Display", body: "DM Sans", why: "Magazine feel with a light body." },
  ],
  technical: [
    { heading: "Space Grotesk", body: "Inter", why: "Engineered; tech, hardware, B2B." },
    { heading: "Space Grotesk", body: "DM Sans", why: "Technical but softer to read." },
  ],
  bold: [
    { heading: "Space Grotesk", body: "Manrope", why: "Big, confident display type; launches and events." },
    { heading: "Poppins", body: "Inter", why: "Heavy weights hold up in large hero headings." },
  ],
};

// ---------------------------------------------------------------- recipes

export type RecipeKind = "landing" | "portfolio" | "store";
export type RecipeMood = "minimal" | "warm" | "premium" | "playful" | "corporate" | "bold";

type Recipe = {
  fonts: { heading: Font; body: Font };
  radius: "none" | "sm" | "md" | "lg" | "full";
  motion: "none" | "subtle" | "lively";
  paletteMood: PaletteMood;
  imagery: string;
  copy: string;
};

const MOODS: Record<RecipeMood, Recipe> = {
  minimal: { fonts: { heading: "Manrope", body: "Inter" }, radius: "sm", motion: "subtle", paletteMood: "light", imagery: "Few, large photos with lots of empty space; neutral backgrounds.", copy: "Short sentences. One idea per section." },
  warm: { fonts: { heading: "Poppins", body: "DM Sans" }, radius: "lg", motion: "subtle", paletteMood: "warm", imagery: "People and hands at work, daylight, natural materials.", copy: "Personal and local; name the neighbourhood, the family, the years." },
  premium: { fonts: { heading: "Playfair Display", body: "Lora" }, radius: "none", motion: "subtle", paletteMood: "dark", imagery: "Close-up product and texture shots, low-key lighting.", copy: "Understated. Let details carry it; no exclamation marks." },
  playful: { fonts: { heading: "Outfit", body: "DM Sans" }, radius: "full", motion: "lively", paletteMood: "vivid", imagery: "Bright, colourful, candid; illustrations suit it too.", copy: "Upbeat and direct; short headings that could be spoken." },
  corporate: { fonts: { heading: "Manrope", body: "Inter" }, radius: "md", motion: "subtle", paletteMood: "cool", imagery: "Teams, offices, clean product shots; avoid obvious stock handshakes.", copy: "Outcome first, proof second (numbers, clients, certifications)." },
  bold: { fonts: { heading: "Space Grotesk", body: "Manrope" }, radius: "none", motion: "lively", paletteMood: "dark", imagery: "Full-bleed, high-contrast images; one strong colour.", copy: "Big claims backed by a stat; imperative calls to action." },
};

const LAYOUTS: Record<RecipeKind, string[]> = {
  landing: [
    "hero — the promise in one line, one primary CTA, a real photo",
    "stats — three numbers that prove it (years, customers, rating)",
    "features — three or four benefits, not features",
    "imageText — how it works, or the story",
    "testimonials — two or three named customers",
    "faq — the questions that stop people buying",
    "cta — one repeated call to action",
    "contact — phone, WhatsApp and address for a local business",
  ],
  portfolio: [
    "hero — name, role and one line on the work (align left suits portfolios)",
    "collection (profile, layout about)",
    "collection (projects, layout cards) — the work leads",
    "collection (experience, layout timeline)",
    "collection (skills, layout chips)",
    "collection (testimonials) or testimonials",
    "contact",
  ],
  store: [
    "hero — what they sell and why here, CTA to the products",
    "productGrid — best sellers (sort newest or by a category)",
    "features — delivery, returns, payment, warranty",
    "productGrid — a second category",
    "testimonials",
    "faq — shipping, returns, payment",
    "contact",
  ],
};

// ---------------------------------------------------------------- photos

export type Photo = { url: string; alt: string; credit: string; width: number; height: number; source: "unsplash" | "pexels" };

async function unsplash(key: string, query: string, orientation: string, count: number, f: typeof fetch): Promise<Photo[]> {
  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(count));
  url.searchParams.set("orientation", orientation === "square" ? "squarish" : orientation);
  url.searchParams.set("content_filter", "high");
  const res = await f(url, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Unsplash answered ${res.status}`);
  const body = (await res.json()) as {
    results: { urls: { raw: string }; alt_description: string | null; description: string | null; width: number; height: number; user: { name: string } }[];
  };
  return body.results.map((p) => ({
    // Unsplash asks for hotlinking from its CDN, sized by URL parameters.
    url: `${p.urls.raw}${p.urls.raw.includes("?") ? "&" : "?"}w=1600&q=80&auto=format&fit=crop`,
    alt: p.alt_description ?? p.description ?? query,
    credit: `Photo by ${p.user.name} on Unsplash`,
    width: p.width,
    height: p.height,
    source: "unsplash" as const,
  }));
}

async function pexels(key: string, query: string, orientation: string, count: number, f: typeof fetch): Promise<Photo[]> {
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(count));
  url.searchParams.set("orientation", orientation);
  const res = await f(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Pexels answered ${res.status}`);
  const body = (await res.json()) as {
    photos: { src: { large2x: string }; alt: string; width: number; height: number; photographer: string }[];
  };
  return body.photos.map((p) => ({
    url: p.src.large2x,
    alt: p.alt || query,
    credit: `Photo by ${p.photographer} on Pexels`,
    width: p.width,
    height: p.height,
    source: "pexels" as const,
  }));
}

export function photosAvailable(opts: DesignKitOptions): boolean {
  return Boolean(opts.unsplashKey || opts.pexelsKey);
}

// ---------------------------------------------------------------- server

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const Hex = z.string().regex(HEX, "a hex colour like #22314f");

export function createDesignKitServer(opts: DesignKitOptions = {}): McpServer {
  const f = opts.fetch ?? fetch;
  const server = new McpServer({ name: "zuuvy-design-kit", version: "1.0.0" });

  server.registerTool(
    "palette",
    {
      description:
        "A complete, accessible site palette (the theme's six colours: primary, background, surface, text, muted, accent) built from one brand colour. Text and buttons are checked for contrast. Use its colours with set_theme — colours the brand kit fixes stay fixed regardless.",
      inputSchema: {
        brand: Hex.describe("The brand's main colour"),
        mood: z.enum(["light", "dark", "warm", "cool", "vivid"]).default("light").describe("Page tone"),
      },
    },
    async ({ brand, mood }) => json(paletteFrom(brand, mood)),
  );

  server.registerTool(
    "check_contrast",
    {
      description: "WCAG contrast ratio between two colours, and whether it passes for body text (4.5) and large text (3).",
      inputSchema: { foreground: Hex, background: Hex },
    },
    async ({ foreground, background }) => {
      const ratio = contrast(foreground, background);
      return json({ ratio, bodyText: ratio >= 4.5, largeText: ratio >= 3, aaa: ratio >= 7 });
    },
  );

  server.registerTool(
    "font_pairings",
    {
      description: `Heading/body font pairs from the fonts a site can use (${FONTS.join(", ")}), for a type style, with why each suits.`,
      inputSchema: { style: z.enum(["modern", "friendly", "elegant", "editorial", "technical", "bold"]) },
    },
    async ({ style }) => json(PAIRINGS[style]),
  );

  server.registerTool(
    "style_recipe",
    {
      description:
        "A starting design for a kind of site and a mood: fonts, corner radius, motion, palette tone, imagery and copy guidance, and a section order in this builder's section types. A starting point to adapt to the business — not a template to copy word for word.",
      inputSchema: {
        kind: z.enum(["landing", "portfolio", "store"]),
        mood: z.enum(["minimal", "warm", "premium", "playful", "corporate", "bold"]),
      },
    },
    async ({ kind, mood }) => json({ ...MOODS[mood], sections: LAYOUTS[kind] }),
  );

  server.registerTool(
    "search_icons",
    {
      description:
        "Find icons for features, steps, stats, bullets and marquee separators. Returns Lucide icon names to put in `icon` fields exactly as given. Search in plain words about the meaning: \"fast delivery\", \"warranty\", \"cake\", \"secure payment\".",
      inputSchema: {
        query: z.string().min(2).max(80),
        limit: z.number().int().min(1).max(30).default(12),
      },
    },
    async ({ query, limit }) => {
      const local = searchIcons(query, limit);
      // Iconify's search knows each icon's tags, so it finds meanings a name misses. Fixed host; only Lucide names that exist here are kept.
      let remote: string[] = [];
      try {
        const url = new URL("https://api.iconify.design/search");
        url.searchParams.set("query", query);
        url.searchParams.set("prefix", "lucide");
        url.searchParams.set("limit", String(Math.max(limit, 32)));
        const res = await f(url, { signal: AbortSignal.timeout(2500) });
        if (res.ok) {
          const body = (await res.json()) as { icons?: string[] };
          remote = (body.icons ?? []).map((i) => i.replace(/^lucide:/, "")).filter(isIconName);
        }
      } catch {
        /* offline: the local search stands alone */
      }
      const icons = [...new Set([...local.slice(0, 4), ...remote, ...local])].slice(0, limit);
      return json({ icons, hint: icons.length ? "Use one of these names in an icon field." : "Nothing matched; try a simpler word (truck, star, heart, shield)." });
    },
  );

  server.registerTool(
    "skill",
    {
      description: `A design skill to follow: ${SKILL_NAMES.map((n) => `${n} (${SKILLS[n].summary})`).join("; ")}.`,
      inputSchema: { name: z.enum(SKILL_NAMES as [string, ...string[]]) },
    },
    async ({ name }) => ({ content: [{ type: "text" as const, text: SKILLS[name as keyof typeof SKILLS].body }] }),
  );

  // The same skills as MCP prompts, for clients that offer prompts to their users.
  for (const name of SKILL_NAMES) {
    server.registerPrompt(name, { title: SKILLS[name].title, description: SKILLS[name].summary }, () => ({
      messages: [{ role: "user" as const, content: { type: "text" as const, text: SKILLS[name].body } }],
    }));
  }

  if (photosAvailable(opts)) {
    server.registerTool(
      "search_photos",
      {
        description:
          "Real stock photography. Returns https image URLs you can put straight into image fields (hero, imageText, gallery), with alt text and the photographer's credit. Search in plain concrete words (\"indian bakery counter\", \"hands potting plants\"); prefer these to generated pictures for real places, people and food.",
        inputSchema: {
          query: z.string().min(2).max(100),
          orientation: z.enum(["landscape", "portrait", "square"]).default("landscape"),
          count: z.number().int().min(1).max(10).default(5),
        },
      },
      async ({ query, orientation, count }) => {
        const photos = opts.unsplashKey
          ? await unsplash(opts.unsplashKey, query, orientation, count, f)
          : await pexels(opts.pexelsKey!, query, orientation, count, f);
        if (!photos.length) return json({ photos: [], hint: "Nothing found; try broader or more concrete words." });
        return json({ photos, attribution: "Put the credit in a caption or the footer where the design allows." });
      },
    );
  }

  return server;
}
