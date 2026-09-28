/** Outbox topics and what runs them. The worker drains with these. */
import { syncCatalog } from "./catalog";
import { checkDomain, provisionDomain, releaseCertificate } from "./domains";
import { type Email, sendEmail } from "./email";
import { mergeVersion, pushVersion } from "./git";
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
  "domain.provision": {
    run: (job) => provisionDomain(job.tenant_id, String(job.payload.domainId), String(job.payload.startedAt ?? new Date().toISOString())),
  },
  "domain.check": {
    run: async (job) => {
      await checkDomain(job.tenant_id, String(job.payload.domainId), String(job.payload.startedAt), Boolean(job.payload.manual));
    },
  },
  "domain.release": {
    run: (job) => releaseCertificate(String(job.payload.certificateArn)),
  },
  "email.send": {
    run: (job) => sendEmail(job.payload as unknown as Email),
  },
  "git.push": {
    run: (job) => pushVersion(job.tenant_id, String(job.payload.siteId), String(job.payload.versionId)),
  },
  "git.merge": {
    run: (job) => mergeVersion(job.tenant_id, String(job.payload.siteId), String(job.payload.versionId)),
  },
};
