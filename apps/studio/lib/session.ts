import "server-only";
import { type PlatformRole, type Session, getSession, platformRole } from "@zsite/platform";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

export const SESSION_COOKIE = "zs_session";

/** The signed-in person and their business, once per request. */
export const currentSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSession(token);
});

/**
 * Every page *and every server action* calls this. A layout's check does not
 * protect an action, which is reachable by a POST from anywhere.
 */
export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect("/login");
  return session;
}

export async function setSessionCookie(token: string, expires: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

/** The internal dashboard: a platform admin, or a 404 — its existence is not advertised. */
export async function requirePlatformAdmin(): Promise<Session & { platformRole: PlatformRole }> {
  const session = await requireSession();
  const role = await platformRole(session.user.id);
  if (!role) notFound();
  return { ...session, platformRole: role };
}
