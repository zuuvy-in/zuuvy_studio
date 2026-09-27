/**
 * Applies db/migrations/*.sql in name order, each once, each in its own
 * transaction, as the admin (owner) role. Migrations are expand/contract:
 * the schema is always current for every tenant, and old and new code must
 * both run against it during a deploy. What tenants upgrade on their own
 * schedule is the *runtime* their site renders with, never the schema.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

/** Any constant: every migrating process takes the same session-level lock. */
const MIGRATION_LOCK = 72_635_901;

export async function migrate(
  adminUrl: string,
  dir: string,
  log: (s: string) => void = () => {},
  opts: { ssl?: boolean } = {},
): Promise<string[]> {
  const client = new pg.Client({ connectionString: adminUrl, ssl: opts.ssl ? { rejectUnauthorized: true } : undefined });
  await client.connect();
  const applied: string[] = [];
  try {
    // Two deploys (or a retried one) must not apply the same migration twice.
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(
      "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name as string));
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        throw new Error(`${file}: ${(e as Error).message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
    await client.end();
  }
  return applied;
}
