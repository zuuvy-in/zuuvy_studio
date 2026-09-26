/**
 * The outbox: work that must happen after a commit and survive a crash.
 *
 * A job is written in the same transaction as the change that needs it (an
 * order and "send this order to Zuuvy" commit together or not at all), then a
 * worker claims and runs it inside the job's own tenant context. Failures back
 * off; a `PermanentError`, or running out of attempts, parks the job as
 * `dead` and runs the topic's `onDead` so the record says what happened.
 * In production the worker is fed by SQS; the table stays the source of truth.
 */
import { type Tx, withGlobal, withTenant } from "./db";

export class PermanentError extends Error {
  override name = "PermanentError";
}

export const MAX_ATTEMPTS = 8;

export type Job = { id: number; tenant_id: string; topic: string; payload: Record<string, unknown>; attempts: number };

export type Handler = {
  run(job: Job): Promise<void>;
  onDead?(job: Job, error: Error): Promise<void>;
};

export async function enqueue(tx: Tx, topic: string, payload: Record<string, unknown>, delaySeconds = 0): Promise<number> {
  const row = await tx.get<{ id: number }>(
    `insert into outbox (tenant_id, topic, payload, run_after)
     values (app_tenant(), $1, $2, now() + make_interval(secs => $3)) returning id`,
    [topic, JSON.stringify(payload), delaySeconds],
  );
  return row.id;
}

/** 10s, 40s, 90s, 160s … capped at an hour. */
export function backoffSeconds(attempts: number): number {
  return Math.min(3600, 10 * attempts * attempts);
}

export type DrainResult = { ran: number; failed: number; dead: number };

export async function drainOutbox(handlers: Record<string, Handler>, limit = 20): Promise<DrainResult> {
  const jobs = await withGlobal((tx) =>
    tx.query<Job>("select id, tenant_id, topic, payload, attempts from claim_outbox($1)", [limit]),
  );
  const result: DrainResult = { ran: 0, failed: 0, dead: 0 };
  for (const job of jobs) {
    const handler = handlers[job.topic];
    try {
      if (!handler) throw new PermanentError(`no handler for ${job.topic}`);
      await handler.run(job);
      await withTenant(job.tenant_id, (tx) =>
        tx.query("update outbox set status = 'done', locked_at = null, last_error = null where id = $1", [job.id]),
      );
      result.ran++;
    } catch (e) {
      const error = e as Error;
      const dead = error instanceof PermanentError || job.attempts >= MAX_ATTEMPTS;
      await withTenant(job.tenant_id, (tx) =>
        tx.query(
          `update outbox set status = $2, locked_at = null, last_error = $3,
             run_after = now() + make_interval(secs => $4) where id = $1`,
          [job.id, dead ? "dead" : "pending", error.message.slice(0, 1000), backoffSeconds(job.attempts)],
        ),
      );
      if (dead) {
        result.dead++;
        await handler?.onDead?.(job, error).catch(() => {});
      } else {
        result.failed++;
      }
    }
  }
  return result;
}
