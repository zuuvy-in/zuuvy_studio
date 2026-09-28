/**
 * Subdomains under the platform domain (`<name>.zuuvy.site`) and the hosts a
 * request can arrive on.
 *
 * `zuuvy.site` is meant to go on the Public Suffix List, as github.io and
 * vercel.app are: without that, two tenants' sites count as one "site" to the
 * browser and one tenant's script can set cookies the other's pages read.
 */

/** Names nobody may claim: platform surfaces, mail, and obvious phishing bait. */
export const RESERVED_SUBDOMAINS = new Set([
  "www", "api", "app", "studio", "admin", "dashboard", "mail", "smtp", "imap", "pop",
  "ftp", "status", "help", "support", "docs", "blog", "cdn", "static", "assets",
  "auth", "login", "signin", "signup", "account", "accounts", "billing", "pay",
  "payments", "secure", "zuuvy", "preview", "hooks", "webhooks", "ns1", "ns2",
]);

export function normaliseSubdomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Why a subdomain cannot be used, or null when it can. */
export function subdomainProblem(name: string): string | null {
  if (name.length < 3) return "Use at least 3 characters.";
  if (name.length > 40) return "Use at most 40 characters.";
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name)) {
    return "Use lowercase letters, numbers and hyphens, starting and ending with a letter or number.";
  }
  if (name.includes("--")) return "Avoid double hyphens.";
  if (RESERVED_SUBDOMAINS.has(name)) return "That name is reserved.";
  return null;
}

/**
 * Which site a Host header names. `acme.zuuvy.site` → subdomain `acme`;
 * `acme.localhost:3001` works the same in development (browsers resolve
 * `*.localhost` to loopback); anything else is a custom domain.
 */
export function parseHost(
  host: string,
  platformDomain: string,
): { subdomain: string } | { domain: string } | null {
  const bare = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (!bare) return null;
  for (const root of [platformDomain.toLowerCase(), "localhost"]) {
    if (bare === root) return null;
    if (bare.endsWith(`.${root}`)) {
      const sub = bare.slice(0, -(root.length + 1));
      return sub.includes(".") ? null : { subdomain: sub };
    }
  }
  // As typed: www.shop.in and shop.in can be two connected domains. The
  // storefront tries the other spelling when only one is connected.
  return { domain: bare };
}
