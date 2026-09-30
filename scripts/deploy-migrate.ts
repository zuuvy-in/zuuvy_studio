/**
 * The deploy's database step, run as a one-off ECS task before new services
 * roll out: apply migrations as the owner, then make sure the app role can
 * log in with the password Secrets Manager generated for it, then make sure
 * the platform's superadmin exists (create-superadmin.ts), then add any premade
 * site not yet on that admin's account. Idempotent.
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

// The premade sites, on that admin's account: only the ones not there yet, so
// an admin's edits (or a showcase they stopped offering) survive every deploy.
// Best-effort — a photo library that is down must not stop a release.
if (process.env.SHOWCASE_SEED !== "0") {
  const { closePool, seedShowcases, unsplashSearch } = await import("@zsite/platform");
  const key = process.env.UNSPLASH_ACCESS_KEY;
  try {
    const done = await seedShowcases(process.env.SUPERADMIN_EMAIL || "rishav@zuuvy.in", {
      mode: "missing",
      search: key ? unsplashSearch(key) : null,
      log: (l) => console.log(`showcase: ${l}`),
    });
    console.log(done.length ? `showcase: ${done.length} premade site(s) seeded${key ? "" : " (no UNSPLASH_ACCESS_KEY: without photos)"}` : "showcase: premade sites are up to date");
  } catch (e) {
    console.log(`showcase: skipped — ${(e as Error).message}`);
  } finally {
    await closePool();
  }
}
