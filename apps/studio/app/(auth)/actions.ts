"use server";

import { createSession, login, signup } from "@zsite/platform";
import { redirect } from "next/navigation";
import { type ActionState, attempt } from "@/lib/actions";
import { setSessionCookie } from "@/lib/session";

const text = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function loginAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const who = await login(text(form, "email"), text(form, "password"));
    const { token, expires } = await createSession(who.userId, who.tenantId);
    await setSessionCookie(token, expires);
    redirect("/");
  });
}

export async function signupAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const who = await signup({
      businessName: text(form, "businessName"),
      name: text(form, "name"),
      email: text(form, "email"),
      password: text(form, "password"),
    });
    const { token, expires } = await createSession(who.userId, who.tenantId);
    await setSessionCookie(token, expires);
    redirect("/sites/new");
  });
}
