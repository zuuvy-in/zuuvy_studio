/** Outbox topics and what runs them. The worker drains with these. */
import { syncCatalog } from "./catalog";
import { markOrderSyncFailed, pushOrder } from "./orders";
import type { Handler } from "./outbox";

export const HANDLERS: Record<string, Handler> = {
  "order.push": {
    run: (job) => pushOrder(job.tenant_id, String(job.payload.orderId), String(job.payload.kind ?? "zuuvy")),
    onDead: (job, error) => markOrderSyncFailed(job.tenant_id, String(job.payload.orderId), error.message),
  },
  "catalog.sync": {
    run: async (job) => {
      await syncCatalog(job.tenant_id, { kind: String(job.payload.kind ?? "zuuvy"), full: Boolean(job.payload.full) });
    },
  },
};
