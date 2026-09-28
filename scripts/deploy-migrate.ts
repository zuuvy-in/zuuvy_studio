/**
 * The deploy's database step, run as a one-off ECS task before new services
 * roll out: apply migrations as the owner, then make sure the app role can
 * log in with the password Secrets Manager generated for it, then make sure
 * the platform's superadmin exists (create-superadmin.ts). Idempotent.
 */
import { join } from "node:path";
import pg from "pg";
import { config, loadRootEnv, migrate } from "@zsite/platform";

loadRootEnv();
const ssl = config.databaseSsl();
const applied = await migrate(config.databaseAdminUrl(), join(import.meta.dirname, "../db/migrations"), (s) => console.log(s), { ssl });
console.log(applied.length ? `${applied.length} migration(s) applied` : "database is up to date");

const password = process.env.DB_APP_PASSWORD;
if (!password) throw new Error("DB_APP_PASSWORD is not set");
const admin = new pg.Client({ connectionString: config.databaseAdminUrl(), ssl: ssl ? { rejectUnauthorized: true } : undefined });
await admin.connect();
try {
  // ALTER ROLE takes no bind parameters; quote the literal with the server's own function.
  const { rows } = await admin.query("select quote_literal($1) as lit", [password]);
  await admin.query(`alter role zsite_app with login password ${rows[0].lit}`);
  console.log("zsite_app login refreshed");
} finally {
  await admin.end();
}

// The first platform admin. Prints a generated password once, the first time only.
await import("./create-superadmin");
