"use server";

import {
  createSession,
  createStarterSite,
  isLandingStart,
  landingPrompt,
  landingQuery,
  login,
  onboard,
  parseLanding,
  sendEmailVerification,
  signup,
  withTenant,
} from "@zsite/platform";
import { redirect } from "next/navigation";
import { type ActionState, attempt } from "@/lib/actions";
import { setSessionCookie } from "@/lib/session";

const text = (f: FormData, k: string) => String(f.get(k) ?? "");
/** The landing page's parameters ride along as hidden `l_<key>` fields. */
const landing = (form: FormData) => parseLanding((k) => (form.get(`l_${k}`) as string | null) ?? null);

export async function loginAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const who = await login(text(form, "email"), text(form, "password"));
    const { token, expires } = await createSession(who.userId, who.tenantId);
    await setSessionCookie(token, expires);
    // An existing customer who came from the landing page: the new-site form, filled in — never a site they did not confirm.
    const p = landing(form);
    redirect(isLandingStart(p) ? `/sites/new${landingQuery(p)}` : "/");
  });
}

export async function signupAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const businessName = text(form, "businessName").trim();
    const email = text(form, "email").trim().toLowerCase();
    const who = await signup({ businessName, name: text(form, "name"), email, password: text(form, "password") });
    const { token, expires } = await createSession(who.userId, who.tenantId);
    await setSessionCookie(token, expires);
    await onboard(who.tenantId, { email, name: text(form, "name").trim() }, businessName);
    await sendEmailVerification(who.tenantId, who.userId);

    let next = "/sites/new";
    const p = landing(form);
    if (isLandingStart(p)) {
      const site = await withTenant(who.tenantId, (tx) => createStarterSite(tx, { params: p, businessName, email, userId: who.userId }));
      next = `/sites/${site.id}/versions?prompt=${encodeURIComponent(landingPrompt(p, businessName))}`;
    }
    redirect(`/welcome?next=${encodeURIComponent(next)}`);
  });
}
