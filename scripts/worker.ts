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
while (!stopping) {
  try {
    const r = await drainOutbox(HANDLERS);
    if (r.ran || r.failed || r.dead) console.log(`worker: ran ${r.ran}, retrying ${r.failed}, dead ${r.dead}`);
  } catch (e) {
    console.error("worker:", (e as Error).message);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
await closePool();
