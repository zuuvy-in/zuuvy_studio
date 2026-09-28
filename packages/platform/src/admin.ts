/**
 * The platform's internal dashboard: every person on Zuuvy Sites, their AI
 * usage and the versions they have made; and who may see it.
 *
 * Platform admins are rows in `platform_admins`, which the application can
 * read but not write: adding or removing one goes through SECURITY DEFINER
 * functions that check, in the database, that the person asking is a
 * superadmin. The first superadmin is seeded by scripts/create-superadmin.ts.
 * The dashboard's reads are functions too (0002), returning metadata and
 * totals only: never a site tree, a credential, a customer or an order.
 */
import { randomBytes } from "node:crypto";
import { signup } from "./auth";
import { UserError, withGlobal } from "./db";
import { monthStart } from "./usage";

export type PlatformRole = "superadmin" | "admin";

export async function platformRole(userId: string | null | undefined): Promise<PlatformRole | null> {
  if (!userId) return null;
  const row = await withGlobal((tx) => tx.one<{ role: PlatformRole }>("select role from platform_admins where user_id = $1", [userId]));
  return row?.role ?? null;
}

export async function isPlatformAdmin(userId: string | null | undefined): Promise<boolean> {
  return (await platformRole(userId)) !== null;
}

export type PlatformAdmin = { user_id: string; email: string; name: string; role: PlatformRole; created_at: Date; added_by: string | null };

export async function listPlatformAdmins(): Promise<PlatformAdmin[]> {
  return withGlobal((tx) =>
    tx.query<PlatformAdmin>(
      `select a.user_id, u.email::text as email, u.name, a.role, a.created_at, b.name as added_by
         from platform_admins a join users u on u.id = a.user_id left join users b on b.id = a.created_by
        order by a.role desc, u.name`,
    ),
  );
}

const refusal = (e: unknown): never => {
  const err = e as { code?: string; message: string };
  if (err.code === "42501" || err.code === "22023") throw new UserError(err.message.charAt(0).toUpperCase() + err.message.slice(1) + ".");
  throw e;
};

/**
 * Make somebody a platform admin. An existing account is promoted; a new
 * email gets an account (with its own workspace, so it can sign in) and a
 * generated password, returned once for the superadmin to hand over.
 */
export async function addPlatformAdmin(
  actorId: string,
  input: { email: string; name?: string; role: PlatformRole },
): Promise<{ email: string; created: boolean; password: string | null }> {
  if ((await platformRole(actorId)) !== "superadmin") throw new UserError("Only a superadmin can add platform admins.");
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError("Enter a valid email address.");
  let user = await withGlobal((tx) => tx.one<{ id: string }>("select id from users where email = $1", [email]));
  let password: string | null = null;
  if (!user) {
    password = randomBytes(12).toString("base64url");
    const made = await signup({ businessName: "Zuuvy Sites team", name: input.name?.trim() || email.split("@")[0]!, email, password });
    user = { id: made.userId };
  }
  await withGlobal((tx) => tx.query("select grant_platform_admin($1, $2, $3)", [actorId, user!.id, input.role])).catch(refusal);
  return { email, created: password !== null, password };
}

export async function removePlatformAdmin(actorId: string, userId: string): Promise<void> {
  await withGlobal((tx) => tx.query("select revoke_platform_admin($1, $2)", [actorId, userId])).catch(refusal);
}

export type AdminTotals = {
  users: number;
  businesses: number;
  sites: number;
  published_sites: number;
  versions: number;
  ai_attempts: number;
  input_tokens: number;
  output_tokens: number;
  images: number;
  period_attempts: number;
  period_input_tokens: number;
  period_output_tokens: number;
  domains: number;
  active_domains: number;
};

export type AdminUserRow = {
  user_id: string;
  email: string;
  name: string;
  created_at: Date;
  last_seen: Date | null;
  businesses: string[];
  sites: number;
  versions: number;
  ai_versions: number;
  ai_attempts: number;
  input_tokens: number;
  output_tokens: number;
  images: number;
  period_input_tokens: number;
  period_output_tokens: number;
  period_attempts: number;
};

export type AdminVersionRow = {
  version_id: string;
  business: string;
  site_name: string;
  subdomain: string;
  number: number;
  source: string;
  prompt: string | null;
  summary: string;
  published: boolean;
  created_at: Date;
  input_tokens: number;
  output_tokens: number;
};

export type AdminAttemptRow = {
  created_at: Date;
  business: string;
  site_name: string | null;
  outcome: string;
  error: string | null;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  images: number;
  requests: number;
};

export async function adminTotals(since = monthStart()): Promise<AdminTotals> {
  return withGlobal((tx) => tx.get<AdminTotals>("select * from admin_totals($1)", [since]));
}

export async function adminUsers(since = monthStart()): Promise<AdminUserRow[]> {
  return withGlobal((tx) => tx.query<AdminUserRow>("select * from admin_user_overview($1)", [since]));
}

export async function adminUser(userId: string): Promise<AdminUserRow | undefined> {
  return (await adminUsers()).find((u) => u.user_id === userId);
}

export async function adminUserVersions(userId: string, limit = 200): Promise<AdminVersionRow[]> {
  return withGlobal((tx) => tx.query<AdminVersionRow>("select * from admin_user_versions($1, $2)", [userId, limit]));
}

export async function adminUserAttempts(userId: string, limit = 100): Promise<AdminAttemptRow[]> {
  return withGlobal((tx) => tx.query<AdminAttemptRow>("select * from admin_user_attempts($1, $2)", [userId, limit]));
}

/**
 * A rough cost, for the dashboard only — list prices per million tokens as of
 * 2026 for the default models. Real billing is AWS's; this is a sense of scale.
 */
export const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  "nova-pro": { input: 0.8, output: 3.2 },
  "nova-lite": { input: 0.06, output: 0.24 },
  "nova-micro": { input: 0.035, output: 0.14 },
};

export function estimateUsd(inputTokens: number, outputTokens: number, model = "nova-pro"): number {
  const p = PRICE_PER_MILLION[model] ?? PRICE_PER_MILLION["nova-pro"]!;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
