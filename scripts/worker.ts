/**
 * Drains the outbox: sends orders to Zuuvy, runs catalogue syncs. In
 * production this is a container fed by SQS; locally it polls every 2s.
 */
import { HANDLERS, closePool, drainOutbox, loadRootEnv } from "@zsite/platform";

loadRootEnv();
let stopping = false;
const stop = () => {
  stopping = true;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

console.log("worker: draining the outbox every 2s");
let lastError = "";
while (!stopping) {
  try {
    const r = await drainOutbox(HANDLERS);
    if (lastError) console.log("worker: database reachable again");
    lastError = "";
    if (r.ran || r.failed || r.dead) console.log(`worker: ran ${r.ran}, retrying ${r.failed}, dead ${r.dead}`);
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
  await new Promise((r) => setTimeout(r, 2000));
}
await closePool();
