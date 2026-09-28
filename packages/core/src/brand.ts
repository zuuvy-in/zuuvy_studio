/**
 * The brand kit: what a business has decided about how it looks.
 *
 * Every value the owner sets is fixed. The AI reads it, designs around it,
 * and cannot change it — `set_theme` quietly keeps the fixed values, and
 * `applyBrand` is run over every version the AI produces as the guarantee.
 * What the owner leaves empty the AI chooses; those choices are recorded in
 * `aiColors` so the studio can show them, and stay the AI's to revise.
 */
import { z } from "zod";
import { FONTS, ImageUrl, MOTIONS, type SiteTree, Theme, parseTree } from "./tree";

export const COLOR_KEYS = ["primary", "accent", "background", "surface", "text", "muted"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export const Brand = z.object({
  logo: ImageUrl.optional(),
  colors: Theme.shape.colors.partial().default({}),
  fonts: z.object({ heading: z.enum(FONTS), body: z.enum(FONTS) }).partial().default({}),
  motion: z.enum(MOTIONS).optional(),
  guidelines: z.string().max(3000).optional().describe("Voice, audience, words to use or avoid, anything else about the brand"),
  /** What the AI picked for the colours the owner left open. Informational. */
  aiColors: Theme.shape.colors.partial().optional(),
});
export type Brand = z.infer<typeof Brand>;

export function parseBrand(input: unknown): Brand {
  const r = Brand.safeParse(input ?? {});
  return r.success ? r.data : Brand.parse({});
}

/** The theme fields the owner has fixed, as `colors.primary`, `fonts.body`, `motion`. */
export function lockedThemeFields(brand: Brand): string[] {
  return [
    ...Object.keys(brand.colors).map((k) => `colors.${k}`),
    ...Object.keys(brand.fonts).map((k) => `fonts.${k}`),
    ...(brand.motion ? ["motion"] : []),
  ];
}

/** The site tree with every fixed brand value written into it. Idempotent. */
export function applyBrand(tree: SiteTree, brand: Brand): SiteTree {
  const next = structuredClone(tree);
  next.theme.colors = { ...next.theme.colors, ...brand.colors };
  next.theme.fonts = { ...next.theme.fonts, ...brand.fonts };
  if (brand.motion) next.theme.motion = brand.motion;
  if (brand.logo) next.nav.logo = brand.logo;
  return parseTree(next);
}

/** Colours the AI settled on for the keys the owner left open — kept in `aiColors`. */
export function aiChosenColors(tree: SiteTree, brand: Brand): Partial<Record<ColorKey, string>> {
  const out: Partial<Record<ColorKey, string>> = {};
  for (const k of COLOR_KEYS) if (!brand.colors[k]) out[k] = tree.theme.colors[k];
  return out;
}

/** A plain-language brief of the brand kit, for the AI. */
export function brandBrief(brand: Brand): string {
  const lines: string[] = [];
  const fixed = Object.entries(brand.colors);
  lines.push(
    fixed.length
      ? `Brand colours fixed by the owner (never change these; build everything else to suit them): ${fixed.map(([k, v]) => `${k} ${v}`).join(", ")}.`
      : "Brand colours: not set by the owner — choose a palette that fits this business, and keep it consistent.",
  );
  const open = COLOR_KEYS.filter((k) => !brand.colors[k]);
  if (fixed.length && open.length) lines.push(`You choose the remaining colours (${open.join(", ")}) to complement the fixed ones.`);
  const fonts = Object.entries(brand.fonts);
  if (fonts.length) lines.push(`Brand fonts fixed by the owner: ${fonts.map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  if (brand.motion) lines.push(`Animation fixed by the owner: ${brand.motion}.`);
  if (brand.logo) lines.push("The owner has a logo; it is shown in the header automatically.");
  if (brand.guidelines?.trim()) lines.push(`Brand guidelines from the owner:\n${brand.guidelines.trim()}`);
  lines.push("Generated pictures and illustrations should use the brand palette so they sit naturally on the page.");
  return lines.join("\n");
}

/** Colours worth naming in an image prompt: fixed ones first, then the site's own. */
export function paletteForImages(tree: SiteTree | null, brand: Brand): string[] {
  const c = { ...(tree?.theme.colors ?? {}), ...brand.colors };
  return [c.primary, c.accent, c.surface].filter((v): v is string => Boolean(v));
}
