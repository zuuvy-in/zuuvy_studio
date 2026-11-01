/**
 * Drains the outbox: sends orders to Zuuvy, runs catalogue syncs. Polls every
 * 2s. With WORKER_IDLE_POLL_MAX_MS set, the gap doubles while there is nothing
 * to do, up to that ceiling, and drops back to 2s as soon as a job runs — so
 * the database can go idle long enough for Aurora to pause.
 */
import { HANDLERS, closePool, drainOutbox, loadRootEnv } from "@zsite/platform";

loadRootEnv();
let stopping = false;
const stop = () => {
  stopping = true;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const BASE_MS = 2000;
const maxIdleMs = Math.max(BASE_MS, Number(process.env.WORKER_IDLE_POLL_MAX_MS || BASE_MS));
console.log(`worker: draining the outbox every ${BASE_MS / 1000}s` + (maxIdleMs > BASE_MS ? `, backing off to ${maxIdleMs / 1000}s when idle` : ""));
let lastError = "";
let waitMs = BASE_MS;
while (!stopping) {
  try {
    const r = await drainOutbox(HANDLERS);
    if (lastError) console.log("worker: database reachable again");
    lastError = "";
    if (r.ran || r.failed || r.dead) console.log(`worker: ran ${r.ran}, retrying ${r.failed}, dead ${r.dead}`);
    waitMs = r.ran || r.failed ? BASE_MS : Math.min(waitMs * 2, maxIdleMs);
  } catch (e) {
    const err = e as Error & { code?: string };
    // Say it once, not every two seconds.
    if (err.message !== lastError) {
      console.error("worker:", err.message);
      if (err.code === "ECONNREFUSED") console.error("worker: is Postgres running? `npm run db:start` (then db:migrate and db:seed on first run)");
      if (err.code === "42P01" || err.code === "42883") console.error("worker: the database is not migrated — `npm run db:migrate`");
    }
    lastError = err.message;
  }
  // Sleep in short slices so SIGTERM (a Spot interruption, a deploy) still stops promptly.
  for (let slept = 0; slept < waitMs && !stopping; slept += BASE_MS) await new Promise((r) => setTimeout(r, BASE_MS));
}
await closePool();
