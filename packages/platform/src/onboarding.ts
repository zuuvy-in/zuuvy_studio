/**
 * Starting from the Zuuvy Sites landing page. Its form sends the visitor to
 * the studio's signup page with what they typed as URL parameters:
 *
 *   /signup?business=Asha+Bakes&name=Asha&email=asha@x.in&phone=98765+43210
 *          &kind=store&site=Asha+Bakes&tagline=Cakes+that+arrive+warm
 *          &prompt=A+bright+site+for+my+bakery+in+Patna&subdomain=ashabakes
 *
 * Every parameter is optional. The signup form is filled in from them, and
 * once the account exists a site is created for them straight away — named
 * "Default" unless `site` says otherwise — and the builder opens with the
 * prompt waiting, so the first thing they see is a plan for their own site.
 *
 * Nothing here is trusted: it is what a stranger typed into a public form, so
 * each value is trimmed, bounded and checked the way the form's own fields are.
 */
import { type SiteKind, normaliseSubdomain } from "@zsite/core";
import { randomBytes } from "node:crypto";
import { type Tx, UserError } from "./db";
import { checkSubdomain, createSite, type Site } from "./sites";

export type LandingParams = {
  business?: string;
  name?: string;
  email?: string;
  phone?: string;
  kind?: SiteKind;
  site?: string;
  tagline?: string;
  prompt?: string;
  subdomain?: string;
};

/** Which parameters travel from the landing page (and through sign in). */
export const LANDING_KEYS = ["business", "name", "email", "phone", "kind", "site", "tagline", "prompt", "subdomain"] as const;

const TEMPLATE_FOR: Record<SiteKind, string> = { landing: "landing-launch", portfolio: "portfolio-studio", store: "store-classic" };
const KIND_WORDS: Record<string, SiteKind> = {
  landing: "landing",
  business: "landing",
  website: "landing",
  portfolio: "portfolio",
  store: "store",
  shop: "store",
  ecommerce: "store",
  "e-commerce": "store",
};
const LIMITS: Record<(typeof LANDING_KEYS)[number], number> = {
  business: 80,
  name: 80,
  email: 120,
  phone: 20,
  kind: 20,
  site: 60,
  tagline: 160,
  prompt: 1000,
  subdomain: 40,
};

/** Read the parameters from anything with a `get` (URLSearchParams, FormData). */
export function parseLanding(get: (key: string) => string | null | undefined): LandingParams {
  const out: LandingParams = {};
  for (const key of LANDING_KEYS) {
    const raw = get(key);
    if (typeof raw !== "string") continue;
    // Collapse whitespace except in the prompt, where line breaks can matter.
    const value = (key === "prompt" ? raw.replace(/\r\n/g, "\n") : raw.replace(/\s+/g, " ")).trim().slice(0, LIMITS[key]);
    if (!value) continue;
    if (key === "kind") {
      const kind = KIND_WORDS[value.toLowerCase()];
      if (kind) out.kind = kind;
    } else if (key === "email") {
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) out.email = value.toLowerCase();
    } else if (key === "phone") {
      if (/^[+\d][\d\s()-]{6,19}$/.test(value)) out.phone = value;
    } else if (key === "subdomain") {
      const s = normaliseSubdomain(value);
      if (s) out.subdomain = s;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Whether the visitor came from the landing page with something to build. */
export function isLandingStart(p: LandingParams): boolean {
  return Boolean(p.kind || p.site || p.prompt || p.tagline || p.subdomain);
}

/** Back into a query string, for passing along (signup → sign in and back). */
export function landingQuery(p: LandingParams): string {
  const q = new URLSearchParams();
  for (const key of LANDING_KEYS) if (p[key]) q.set(key, String(p[key]));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** What the builder opens with: their own words, or a one-liner made from the form. */
export function landingPrompt(p: LandingParams, businessName: string): string {
  if (p.prompt) return p.prompt;
  const what = { landing: "website", portfolio: "portfolio site", store: "online store" }[p.kind ?? "landing"];
  return `A ${what} for ${businessName}${p.tagline ? ` — ${p.tagline}` : ""}`;
}

/**
 * The site a landing-page visitor asked for, created the moment their account
 * exists. The address is theirs if free, else the business name, else either
 * with a short suffix — a taken address is not a reason to lose the signup.
 */
export async function createStarterSite(
  tx: Tx,
  input: { params: LandingParams; businessName: string; email: string; userId: string },
): Promise<Site> {
  const p = input.params;
  const kind = p.kind ?? "landing";
  const base = p.subdomain || normaliseSubdomain(p.site && p.site !== "Default" ? p.site : input.businessName).slice(0, 30) || "site";
  let subdomain = "";
  for (const candidate of [base, `${base}-${randomBytes(2).toString("hex")}`, `${base}-${randomBytes(3).toString("hex")}`]) {
    if (!(await checkSubdomain(tx, candidate)).problem) {
      subdomain = candidate;
      break;
    }
  }
  if (!subdomain) throw new UserError("Could not find a free web address — create your site from the Sites page.");
  return createSite(tx, {
    name: p.site || "Default",
    subdomain,
    templateId: TEMPLATE_FOR[kind],
    templateInput: { businessName: input.businessName, tagline: p.tagline, email: input.email, phone: p.phone },
    userId: input.userId,
  });
}
