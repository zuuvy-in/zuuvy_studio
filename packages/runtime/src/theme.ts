/**
 * Theme tokens → CSS custom properties. Button ink is chosen by WCAG
 * luminance, so a business cannot make its own buttons unreadable by picking
 * a pale brand colour — the rule the Zuuvy till already follows.
 */
import type { Theme } from "@zsite/core";
import type { CSSProperties } from "react";

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Black or white, whichever reads better on `bg`. */
export function inkFor(bg: string): string {
  return contrast(bg, "#ffffff") >= contrast(bg, "#111111") ? "#ffffff" : "#111111";
}

const RADIUS: Record<Theme["radius"], string> = { none: "0px", sm: "4px", md: "10px", lg: "18px", full: "999px" };

export function themeStyle(theme: Theme): CSSProperties {
  const c = theme.colors;
  return {
    "--zs-primary": c.primary,
    "--zs-primary-ink": inkFor(c.primary),
    "--zs-accent": c.accent,
    "--zs-accent-ink": inkFor(c.accent),
    "--zs-bg": c.background,
    "--zs-surface": c.surface,
    "--zs-text": c.text,
    "--zs-muted": c.muted,
    "--zs-radius": RADIUS[theme.radius],
    "--zs-radius-card": theme.radius === "full" ? "24px" : RADIUS[theme.radius],
    "--zs-font-heading": `"${theme.fonts.heading}", ui-sans-serif, system-ui, sans-serif`,
    "--zs-font-body": `"${theme.fonts.body}", ui-sans-serif, system-ui, sans-serif`,
  } as CSSProperties;
}

export function fontsHref(theme: Theme): string {
  const families = [...new Set([theme.fonts.heading, theme.fonts.body])]
    .map((f) => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}
