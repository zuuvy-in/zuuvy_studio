/**
 * Make sure the platform has its superadmin. Idempotent: an existing account
 * is promoted, a missing one is created — with SUPERADMIN_PASSWORD if set,
 * otherwise a generated password printed once — and running it again changes
 * nothing. The deploy's migration task runs it after every migration.
 *
 *   npm run admin:create                         # rishav@zuuvy.in
 *   npm run admin:create -- --email a@b.in --name "A B" [--password …]
 *
 * It writes platform_admins as the database owner, the one way a first
 * superadmin can exist (the application role cannot write that table).
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import pg from "pg";
import { closePool, config, loadRootEnv, signup, withGlobal } from "@zsite/platform";

loadRootEnv();
const { values } = parseArgs({
  options: {
    email: { type: "string", default: process.env.SUPERADMIN_EMAIL || "rishav@zuuvy.in" },
    name: { type: "string", default: process.env.SUPERADMIN_NAME || "Rishav" },
    password: { type: "string", default: process.env.SUPERADMIN_PASSWORD || "" },
  },
});
const email = values.email!.trim().toLowerCase();

let user = await withGlobal((tx) => tx.one<{ id: string }>("select id from users where email = $1", [email]));
if (user) {
  console.log(`superadmin: ${email} already has an account`);
} else {
  const password = values.password || randomBytes(12).toString("base64url");
  const made = await signup({ businessName: "Zuuvy", name: values.name!, email, password });
  user = { id: made.userId };
  console.log(`superadmin: created ${email}`);
  if (!values.password) console.log(`superadmin: generated password (shown once — sign in and keep it safe): ${password}`);
}

const ssl = config.databaseSsl();
const owner = new pg.Client({ connectionString: config.databaseAdminUrl(), ssl: ssl ? { rejectUnauthorized: true } : undefined });
await owner.connect();
try {
  const r = await owner.query(
    `insert into platform_admins (user_id, role) values ($1, 'superadmin')
     on conflict (user_id) do update set role = 'superadmin' where platform_admins.role <> 'superadmin'
     returning user_id`,
    [user.id],
  );
  console.log(r.rowCount ? `superadmin: ${email} is a superadmin now` : `superadmin: ${email} was already a superadmin`);
} finally {
  await owner.end();
  await closePool();
}
