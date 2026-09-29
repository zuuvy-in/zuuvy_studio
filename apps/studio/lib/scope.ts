import "server-only";
import { type Tx, getSite, isUuid } from "@zsite/platform";

/** Business-wide (siteId undefined, base "") or one site's (base "/sites/<id>"). */
export type Scope = { siteId?: string; base: string };

const make = (raw: unknown): Scope => {
  const siteId = typeof raw === "string" && isUuid(raw) ? raw : undefined;
  return { siteId, base: siteId ? `/sites/${siteId}` : "" };
};

/** For a page reached at /x or at /sites/<id>/x. */
export async function pageScope(params?: Promise<Record<string, string | undefined>>): Promise<Scope> {
  return make(params ? (await params).siteId : undefined);
}

/** For an action: the site the form was on, if any. */
export function formScope(form: FormData): Scope {
  return make(form.get("_scope"));
}

/** The scope's site, checked to be this business's own before anything is filed under it. */
export async function ownSiteId(tx: Tx, scope: Scope): Promise<string | null> {
  if (!scope.siteId) return null;
  await getSite(tx, scope.siteId);
  return scope.siteId;
}
