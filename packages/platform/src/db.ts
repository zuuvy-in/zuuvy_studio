/**
 * Database access. There are exactly two ways in:
 *
 * - `withTenant(tenantId, fn)` — a transaction with `app.tenant_id` set, in
 *   which Row-Level Security confines every query to that tenant. Almost
 *   everything runs here.
 * - `withGlobal(fn)` — a transaction with no tenant, for the global identity
 *   tables (users, memberships, sessions) and the SECURITY DEFINER lookups
 *   that resolve a Host, a webhook URL or a queued job to its tenant. Tenant
 *   tables read as empty here; that is the point.
 *
 * Both connect as `zsite_app`, which owns nothing and cannot bypass RLS.
 */
import pg from "pg";
import { config } from "./config";

// numeric → number. Money is summed in paise (integers) wherever it matters;
// see orders.ts. bigint (bigserial ids, counts) → number.
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(20, (v) => Number(v));

const g = globalThis as unknown as { __zsitePool?: pg.Pool };

export function pool(): pg.Pool {
  if (!g.__zsitePool) {
    g.__zsitePool = new pg.Pool({
      connectionString: config.databaseUrl(),
      max: 10,
      ssl: config.databaseSsl() ? { rejectUnauthorized: true } : undefined,
    });
  }
  return g.__zsitePool;
}

export async function closePool(): Promise<void> {
  const p = g.__zsitePool;
  g.__zsitePool = undefined;
  await p?.end();
}

export type Tx = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** Like one(), but a missing row is a NotFound. */
  get<T = Record<string, unknown>>(sql: string, params?: unknown[], what?: string): Promise<T>;
  tenantId: string | null;
};

export class NotFound extends Error {
  override name = "NotFound";
}

/** A refusal meant for the person: shown as-is in the dashboard. */
export class UserError extends Error {
  override name = "UserError";
}

function wrap(client: pg.PoolClient, tenantId: string | null): Tx {
  const query = async <T>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
  return {
    tenantId,
    query,
    one: async <T>(sql: string, params?: unknown[]) => (await query<T>(sql, params))[0],
    get: async <T>(sql: string, params?: unknown[], what = "record") => {
      const row = (await query<T>(sql, params))[0];
      if (!row) throw new NotFound(`${what} not found`);
      return row;
    },
  };
}

async function transaction<T>(tenantId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    if (tenantId) {
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    }
    const result = await fn(wrap(client, tenantId));
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!isUuid(tenantId)) throw new Error("withTenant needs a tenant id");
  return transaction(tenantId, fn);
}

export function withGlobal<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return transaction(null, fn);
}

/** Postgres unique_violation, optionally on a named constraint. */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" && (!constraint || err.constraint === constraint);
}
