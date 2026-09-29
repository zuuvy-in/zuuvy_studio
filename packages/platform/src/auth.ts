/**
 * Accounts and sessions for the studio.
 *
 * A person is one account across the platform; each business they work in is
 * a membership. A session is bound to one tenant — switching business is a
 * new session. "Sign in with Zuuvy" (OAuth, Zuuvy as the identity provider)
 * will land beside password sign-in and end in the same `createSession`.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { normaliseSubdomain } from "@zsite/core";
import { type Tx, UserError, isUniqueViolation, withGlobal, withTenant } from "./db";
import { queueEmail, verifyEmailMessage } from "./email";
import { randomToken } from "./secrets";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const got = await scrypt(password, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(got, expected);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type Session = {
  user: { id: string; email: string; name: string };
  tenant: { id: string; slug: string; name: string; plan: string };
  role: "owner" | "admin" | "editor";
};

export async function createSession(userId: string, tenantId: string): Promise<{ token: string; expires: Date }> {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await withGlobal((tx) =>
    tx.query("insert into sessions (token_hash, user_id, tenant_id, expires_at) values ($1, $2, $3, $4)", [
      sha256(token),
      userId,
      tenantId,
      expires,
    ]),
  );
  return { token, expires };
}

export async function getSession(token: string | undefined): Promise<Session | null> {
  if (!token || token.length > 100) return null;
  const row = await withGlobal((tx) =>
    tx.one<{ user_id: string; tenant_id: string; email: string; name: string; role: Session["role"] }>(
      `select s.user_id, s.tenant_id, u.email, u.name, m.role
         from sessions s
         join users u on u.id = s.user_id
         join memberships m on m.user_id = s.user_id and m.tenant_id = s.tenant_id
        where s.token_hash = $1 and s.expires_at > now()`,
      [sha256(token)],
    ),
  );
  if (!row) return null;
  // The tenant row is RLS-protected; read it inside its own context.
  const tenant = await withTenant(row.tenant_id, (tx) =>
    tx.one<Session["tenant"]>("select id, slug, name, plan from tenants where id = $1", [row.tenant_id]),
  );
  if (!tenant) return null;
  return { user: { id: row.user_id, email: row.email, name: row.name }, tenant, role: row.role };
}

export async function deleteSession(token: string): Promise<void> {
  await withGlobal((tx) => tx.query("delete from sessions where token_hash = $1", [sha256(token)]));
}

export async function login(email: string, password: string): Promise<{ userId: string; tenantId: string }> {
  const found = await withGlobal(async (tx) => {
    const user = await tx.one<{ id: string; password_hash: string }>(
      "select id, password_hash from users where email = $1",
      [email.trim()],
    );
    if (!user) return null;
    const m = await tx.one<{ tenant_id: string }>(
      "select tenant_id from memberships where user_id = $1 order by created_at limit 1",
      [user.id],
    );
    return m ? { user, tenantId: m.tenant_id } : null;
  });
  // Verify even when the user is missing, so timing does not reveal which emails exist.
  const ok = await verifyPassword(password, found?.user.password_hash ?? (await DUMMY_HASH));
  if (!found || !ok) throw new UserError("That email and password do not match.");
  return { userId: found.user.id, tenantId: found.tenantId };
}

const DUMMY_HASH = hashPassword("not-a-real-password");

export type SignupInput = {
  businessName: string;
  name: string;
  email: string;
  password: string;
  /**
   * Only for accounts the platform itself vouches for (an admin adding a
   * colleague, the seed and superadmin scripts). Everyone signing up proves the
   * address with a link first — see sendEmailVerification.
   */
  emailVerified?: boolean;
};

export async function signup(input: SignupInput): Promise<{ userId: string; tenantId: string }> {
  const businessName = input.businessName.trim();
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (businessName.length < 2) throw new UserError("Enter your business name.");
  if (!name) throw new UserError("Enter your name.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError("Enter a valid email address.");
  if (input.password.length < 8) throw new UserError("Use a password of at least 8 characters.");
  const passwordHash = await hashPassword(input.password);

  return withGlobal(async (tx) => {
    // Never re-credential an existing account: attaching a new business to
    // someone else's email with a password of the signer's choosing would be
    // an account takeover. They sign in instead.
    if (await tx.one("select 1 from users where email = $1", [email])) {
      throw new UserError("That email already has an account — sign in instead.");
    }
    const tenantId = await createTenant(tx, businessName);
    const user = await tx.get<{ id: string }>(
      "insert into users (email, name, password_hash, email_verified_at) values ($1, $2, $3, $4) returning id",
      [email, name, passwordHash, input.emailVerified ? new Date() : null],
    );
    await tx.query("insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner')", [tenantId, user.id]);
    return { userId: user.id, tenantId };
  });
}

async function createTenant(tx: Tx, name: string): Promise<string> {
  const base = normaliseSubdomain(name).slice(0, 30) || "business";
  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomBytes(2).toString("hex")}`;
    try {
      await tx.query("savepoint tenant_slug");
      const row = await tx.get<{ id: string }>("select create_tenant($1, $2) as id", [slug, name]);
      await tx.query("release savepoint tenant_slug");
      return row.id;
    } catch (e) {
      await tx.query("rollback to savepoint tenant_slug");
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new Error("could not allocate a tenant slug");
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

const VERIFY_DAYS = 3;

/** Whether this person has proved they own their email address. */
export async function emailVerified(userId: string): Promise<boolean> {
  const row = await withGlobal((tx) => tx.one<{ at: Date | null }>("select email_verified_at as at from users where id = $1", [userId]));
  return Boolean(row?.at);
}

/**
 * Email a verification link. Any earlier link stops working, so the newest
 * email is the one that counts. Queued with the business's outbox, in its
 * transaction, like every other email.
 */
export async function sendEmailVerification(tenantId: string, userId: string): Promise<{ sent: boolean }> {
  const token = randomToken(32);
  return withTenant(tenantId, async (tx) => {
    const user = await tx.one<{ email: string; name: string; at: Date | null }>(
      "select email, name, email_verified_at as at from users where id = $1",
      [userId],
    );
    if (!user || user.at) return { sent: false };
    await tx.query("delete from email_verifications where user_id = $1", [userId]);
    await tx.query("insert into email_verifications (token_hash, user_id, email, expires_at) values ($1, $2, $3, now() + make_interval(days => $4))", [
      sha256(token),
      userId,
      user.email,
      VERIFY_DAYS,
    ]);
    await queueEmail(tx, verifyEmailMessage(user.email, user.name, token));
    return { sent: true };
  });
}

/** Redeem a link from the email. Answers who was verified, or why not. */
export async function verifyEmail(token: string): Promise<{ userId: string } | { error: string }> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { error: "That link is not complete — open it straight from the email." };
  return withGlobal(async (tx) => {
    const row = await tx.one<{ user_id: string; email: string; expired: boolean }>(
      "select user_id, email, expires_at < now() as expired from email_verifications where token_hash = $1",
      [sha256(token)],
    );
    if (!row) return { error: "That link has already been used or a newer one was sent. Sign in to send a fresh one." };
    if (row.expired) return { error: "That link has expired. Sign in and we will send a fresh one." };
    const done = await tx.one<{ id: string }>(
      "update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1 and email = $2 returning id",
      [row.user_id, row.email],
    );
    await tx.query("delete from email_verifications where user_id = $1", [row.user_id]);
    if (!done) return { error: "Your email address has changed since that link was sent. Sign in to send a fresh one." };
    return { userId: row.user_id };
  });
}

/** Test and admin helper: mark an address as proved. */
export async function markEmailVerified(userId: string): Promise<void> {
  await withGlobal((tx) => tx.query("update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1", [userId]));
}
