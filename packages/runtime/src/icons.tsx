/**
 * Icons for site content: a Lucide name drawn inline as SVG (so it takes the
 * text colour and costs no request), or an https picture from an icon service
 * such as Icons8. An unknown name draws nothing rather than a broken glyph.
 *
 * The icon bodies come from the @iconify-json/lucide package, trusted build
 * input — never from a site tree, which only ever names an icon.
 */
import lucide from "@iconify-json/lucide/icons.json";

type IconSet = { icons: Record<string, { body: string }>; aliases?: Record<string, { parent: string }> };
const SET = lucide as unknown as IconSet;

function body(name: string): string | null {
  const direct = SET.icons[name];
  if (direct) return direct.body;
  const alias = SET.aliases?.[name];
  return alias ? (SET.icons[alias.parent]?.body ?? null) : null;
}

export function iconExists(name: string): boolean {
  return /^https:\/\//i.test(name) || body(name) !== null;
}

export function SiteIcon({ name, className, size = 24, label }: { name?: string; className?: string; size?: number; label?: string }) {
  if (!name) return null;
  if (/^https:\/\//i.test(name)) {
    // A single-colour Icons8 icon (its URL asks for a colour) is drawn as a mask, so it takes the
    // site's own colour — and changes with the brand — instead of the colour baked into the file.
    if (/^https:\/\/img\.icons8\.com\//i.test(name) && /[?&]color=/i.test(name)) {
      return (
        <span
          className={`zs-icon zs-icon-mask ${className ?? ""}`}
          role={label ? "img" : undefined}
          aria-label={label}
          aria-hidden={label ? undefined : true}
          style={{ width: size, height: size, ["--zs-icon-url" as string]: `url("${name.replace(/"/g, "%22")}")` }}
        />
      );
    }
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={name} alt={label ?? ""} width={size} height={size} className={`zs-icon ${className ?? ""}`} loading="lazy" />;
  }
  const svg = body(name);
  if (!svg) return null;
  return (
    <svg
      className={`zs-icon ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      // Package data, not tree data: the tree only chooses which icon.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
