/**
 * Test harness: a fresh database per test file, migrated, with the app
 * connecting as `zsite_app` exactly as it does in production — so the tests
 * exercise Row-Level Security rather than a superuser who bypasses it.
 *
 * Needs the development Postgres (`npm run db:start`).
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { closePool } from "./db";
import { migrate } from "./migrate";
import { handleWebhook } from "./webhooks";

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS = join(here, "../../../db/migrations");

const HOST = process.env.ZSITE_TEST_PG ?? "127.0.0.1:54329";

export async function createTestDatabase(): Promise<{ drop: () => Promise<void> }> {
  const name = `zsite_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: `postgres://postgres@${HOST}/postgres` });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.query(
    "do $$ begin if not exists (select 1 from pg_roles where rolname = 'zsite_app') then create role zsite_app login password 'zsite'; end if; end $$",
  );
  await admin.end();

  await migrate(`postgres://postgres@${HOST}/${name}`, MIGRATIONS);
  process.env.DATABASE_URL = `postgres://zsite_app:zsite@${HOST}/${name}`;
  process.env.DATABASE_ADMIN_URL = `postgres://postgres@${HOST}/${name}`;

  return {
    drop: async () => {
      await closePool();
      const c = new pg.Client({ connectionString: `postgres://postgres@${HOST}/postgres` });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    },
  };
}

/** A local HTTP server that feeds `/api/hooks/<id>` into handleWebhook, like the studio's route does. */
export async function startHookServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const id = (req.url ?? "").split("/").pop() ?? "";
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
    try {
      const r = await handleWebhook(id, headers, Buffer.concat(chunks).toString("utf8"));
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(JSON.stringify(r.body));
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}
