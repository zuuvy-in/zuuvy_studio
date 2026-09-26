/**
 * Inbound webhooks: `POST /api/hooks/<integration id>`.
 *
 * The URL names the integration (and so the tenant); the signature proves the
 * sender holds that integration's secret. Deliveries are de-duplicated by the
 * sender's delivery id — the effect and its log row commit together, and the
 * unique index on (integration, delivery id) makes a concurrent repeat roll
 * back instead of applying twice.
 */
import { ConnectorError, getConnector } from "@zsite/connectors";
import { hideProduct, upsertProduct } from "./catalog";
import { isUniqueViolation, isUuid, withGlobal, withTenant } from "./db";
import { loadConnection, logEvent } from "./integrations";
import { applyOrderStatus, orderReference } from "./orders";

export type WebhookResponse = { status: number; body: Record<string, unknown> };

export async function handleWebhook(
  integrationId: string,
  headers: Record<string, string | undefined>,
  rawBody: string,
): Promise<WebhookResponse> {
  if (!isUuid(integrationId)) return { status: 404, body: { error: "unknown webhook" } };
  if (rawBody.length > 256 * 1024) return { status: 413, body: { error: "too large" } };

  const target = await withGlobal((tx) =>
    tx.one<{ tenant_id: string; kind: string }>("select tenant_id, kind from resolve_integration($1)", [integrationId]),
  );
  if (!target) return { status: 404, body: { error: "unknown webhook" } };
  const connector = getConnector(target.kind);
  if (!connector.parseWebhook) return { status: 404, body: { error: "unknown webhook" } };

  const loaded = await withTenant(target.tenant_id, (tx) => loadConnection(tx, target.kind));
  if (!loaded || loaded.integration.id !== integrationId) return { status: 410, body: { error: "integration disconnected" } };

  let event;
  try {
    event = connector.parseWebhook(loaded.webhookSecret, headers, rawBody);
  } catch (e) {
    const status = e instanceof ConnectorError && e.status ? e.status : 400;
    await withTenant(target.tenant_id, (tx) =>
      logEvent(tx, integrationId, {
        direction: "in",
        topic: headers["x-zuuvy-event"] ?? "unknown",
        status: "error",
        summary: (e as Error).message,
      }),
    );
    return { status, body: { error: (e as Error).message } };
  }

  const payload = safeJson(rawBody);
  try {
    return await withTenant(target.tenant_id, async (tx) => {
      const seen = await tx.one(
        `select 1 from integration_events
          where integration_id = $1 and delivery_id = $2 and direction = 'in' and status <> 'duplicate'`,
        [integrationId, event.deliveryId],
      );
      if (seen) return { status: 200, body: { ok: true, duplicate: true } };

      let status: "ok" | "ignored" = "ok";
      let summary: string;
      let topic: string;
      switch (event.kind) {
        case "order.status": {
          topic = "order.status_changed";
          const order = isUuid(event.requestId)
            ? await tx.one<{ id: string; number: number }>("select id, number from orders where id = $1", [event.requestId])
            : undefined;
          if (!order) {
            status = "ignored";
            summary = `No order ${event.requestId} here (Zuuvy #${event.externalOrderId})`;
            break;
          }
          const r = await applyOrderStatus(tx, order.id, event.status, {
            ref: event.externalOrderId,
            status: event.externalStatus,
            ...(event.note ? { note: event.note } : {}),
            source: "zuuvy",
          });
          if (!r.applied) status = "ignored";
          summary = `${orderReference(order.number)} → ${event.externalStatus}${r.applied ? "" : ` (ignored: ${r.reason})`}`;
          break;
        }
        case "product.upsert":
          topic = "product.updated";
          await upsertProduct(tx, "zuuvy", event.item);
          summary = `${event.item.name}${event.item.listed ? "" : " (unlisted)"}${event.item.stock !== null ? ` · stock ${event.item.stock}` : ""}`;
          break;
        case "product.remove":
          topic = "product.removed";
          await hideProduct(tx, "zuuvy", event.externalId);
          summary = `Product ${event.externalId} taken down`;
          break;
        case "ignored":
          topic = event.topic;
          status = "ignored";
          summary = `Event ${event.topic} is not used here`;
          break;
      }
      await logEvent(tx, integrationId, { direction: "in", topic, status, summary, deliveryId: event.deliveryId, payload });
      return { status: 200, body: { ok: true } };
    });
  } catch (e) {
    // A concurrent delivery of the same id got there first; its effect stands.
    if (isUniqueViolation(e, "integration_events_delivery")) return { status: 200, body: { ok: true, duplicate: true } };
    throw e;
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
