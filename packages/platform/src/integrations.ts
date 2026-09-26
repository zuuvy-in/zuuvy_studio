/**
 * Connected integrations: credentials sealed at rest, a webhook registered
 * with the other side automatically, and an append-only log of everything
 * that crossed the boundary.
 *
 * Network calls happen *outside* database transactions — a slow partner API
 * must not hold a connection and row locks open.
 */
import { type AnyConnector, ConnectorError, type ConnectionInfo, getConnector } from "@zsite/connectors";
import { config } from "./config";
import { NotFound, type Tx, UserError, withTenant } from "./db";
import { enqueue } from "./outbox";
import { open, randomToken, seal } from "./secrets";

export type IntegrationStatus = "connected" | "error" | "disconnected";

export type Integration = {
  id: string;
  kind: string;
  status: IntegrationStatus;
  config: Record<string, unknown> & { info?: ConnectionInfo };
  last_sync_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

type Sealed = { webhookSecret: string } & Record<string, string>;

export type IntegrationEvent = {
  id: number;
  direction: "in" | "out";
  topic: string;
  status: "ok" | "error" | "ignored" | "duplicate";
  summary: string;
  delivery_id: string | null;
  payload: unknown;
  created_at: Date;
};

const COLUMNS = "id, kind, status, config, last_sync_at, last_error, created_at, updated_at";

export function webhookUrl(integrationId: string): string {
  return `${config.publicApiUrl().replace(/\/+$/, "")}/api/hooks/${integrationId}`;
}

export async function listIntegrations(tx: Tx): Promise<Integration[]> {
  return tx.query<Integration>(`select ${COLUMNS} from integrations order by created_at`);
}

export async function getIntegration(tx: Tx, kind: string): Promise<Integration | null> {
  return (await tx.one<Integration>(`select ${COLUMNS} from integrations where kind = $1`, [kind])) ?? null;
}

/** The integration plus its opened credentials, for code about to call out. */
export async function loadConnection(tx: Tx, kind: string) {
  const row = await tx.one<Integration & { secrets: string | null }>(
    `select ${COLUMNS}, secrets from integrations where kind = $1`,
    [kind],
  );
  if (!row || row.status === "disconnected" || !row.secrets) return null;
  const connector = getConnector(kind);
  const secrets = open<Sealed>(row.secrets);
  const { info: _info, ...cfg } = row.config;
  return { integration: row, connector, conn: { config: cfg, secrets }, webhookSecret: secrets.webhookSecret };
}

export async function logEvent(
  tx: Tx,
  integrationId: string,
  e: { direction: "in" | "out"; topic: string; status: IntegrationEvent["status"]; summary: string; deliveryId?: string; payload?: unknown },
): Promise<void> {
  await tx.query(
    `insert into integration_events (tenant_id, integration_id, direction, topic, status, summary, delivery_id, payload)
     values (app_tenant(), $1, $2, $3, $4, $5, $6, $7)`,
    [integrationId, e.direction, e.topic, e.status, e.summary.slice(0, 500), e.deliveryId ?? null,
      e.payload === undefined ? null : JSON.stringify(e.payload)],
  );
}

export async function listEvents(tx: Tx, integrationId: string, limit = 50): Promise<IntegrationEvent[]> {
  return tx.query<IntegrationEvent>(
    `select id, direction, topic, status, summary, delivery_id, payload, created_at
       from integration_events where integration_id = $1 order by id desc limit $2`,
    [integrationId, limit],
  );
}

function userFacing(e: unknown): never {
  if (e instanceof ConnectorError) throw new UserError(e.message);
  throw e;
}

function available(kind: string): AnyConnector {
  let connector: AnyConnector;
  try {
    connector = getConnector(kind);
  } catch {
    throw new NotFound("integration not found");
  }
  if (connector.availability !== "available") throw new UserError(`${connector.name} is not available yet.`);
  return connector;
}

export type ConnectResult = { integration: Integration; info: ConnectionInfo; warning: string | null };

/**
 * Connect (or reconnect with new credentials): check them, store them sealed,
 * register our webhook on the other side, and queue a first catalogue sync.
 */
export async function connectIntegration(
  tenantId: string,
  kind: string,
  input: Record<string, string>,
  opts: { syncNow?: boolean } = {},
): Promise<ConnectResult> {
  const connector = available(kind);
  let parsed: ReturnType<AnyConnector["parse"]>;
  let info: ConnectionInfo;
  try {
    parsed = connector.parse(input);
    info = await connector.test(parsed);
  } catch (e) {
    userFacing(e);
  }

  const webhookSecret = randomToken(32);
  const integration = await withTenant(tenantId, async (tx) => {
    const row = await tx.get<Integration>(
      `insert into integrations (tenant_id, kind, status, config, secrets, last_error)
       values (app_tenant(), $1, 'connected', $2, $3, null)
       on conflict (tenant_id, kind) do update
         set status = 'connected', config = excluded.config, secrets = excluded.secrets,
             last_error = null, updated_at = now()
       returning ${COLUMNS}`,
      [kind, JSON.stringify({ ...parsed.config, info }), seal({ ...parsed.secrets, webhookSecret })],
    );
    await logEvent(tx, row.id, { direction: "out", topic: "connect", status: "ok", summary: `Connected to ${info.headline}` });
    return row;
  });

  let warning: string | null = null;
  if (connector.registerWebhook) {
    try {
      await connector.registerWebhook(parsed, webhookUrl(integration.id), webhookSecret);
      await withTenant(tenantId, (tx) =>
        logEvent(tx, integration.id, { direction: "out", topic: "webhook.register", status: "ok", summary: webhookUrl(integration.id) }),
      );
    } catch (e) {
      warning = `Connected, but ${connector.name} did not accept our webhook address, so order updates will not arrive: ${(e as Error).message}`;
      await withTenant(tenantId, async (tx) => {
        await tx.query("update integrations set status = 'error', last_error = $1, updated_at = now() where id = $2", [warning, integration.id]);
        await logEvent(tx, integration.id, { direction: "out", topic: "webhook.register", status: "error", summary: (e as Error).message });
      });
    }
  }

  if (connector.capabilities.includes("catalog")) {
    if (opts.syncNow) {
      // Import the catalogue now so the person sees products on the next page;
      // if that fails, the worker retries it from the queue.
      const { syncCatalog } = await import("./catalog");
      await syncCatalog(tenantId, { kind, full: true }).catch(() =>
        withTenant(tenantId, (tx) => enqueue(tx, "catalog.sync", { kind, full: true })),
      );
    } else {
      await withTenant(tenantId, (tx) => enqueue(tx, "catalog.sync", { kind, full: true }));
    }
  }
  return { integration, info, warning };
}

export async function testIntegration(tenantId: string, kind: string): Promise<ConnectionInfo> {
  const loaded = await withTenant(tenantId, (tx) => loadConnection(tx, kind));
  if (!loaded) throw new UserError("Not connected.");
  try {
    const info = await loaded.connector.test(loaded.conn);
    await withTenant(tenantId, async (tx) => {
      await tx.query(
        `update integrations set config = jsonb_set(config, '{info}', $1::jsonb),
           status = case when status = 'error' and last_error like 'Connected, but%' then status else 'connected' end,
           last_error = case when status = 'error' and last_error like 'Connected, but%' then last_error else null end,
           updated_at = now() where id = $2`,
        [JSON.stringify(info), loaded.integration.id],
      );
      await logEvent(tx, loaded.integration.id, { direction: "out", topic: "test", status: "ok", summary: `Reached ${info.headline}` });
    });
    return info;
  } catch (e) {
    await withTenant(tenantId, async (tx) => {
      await tx.query("update integrations set status = 'error', last_error = $1, updated_at = now() where id = $2", [
        (e as Error).message,
        loaded.integration.id,
      ]);
      await logEvent(tx, loaded.integration.id, { direction: "out", topic: "test", status: "error", summary: (e as Error).message });
    });
    userFacing(e);
  }
}

/** New webhook secret, registered with the other side; the old one stops working. */
export async function rotateWebhookSecret(tenantId: string, kind: string): Promise<void> {
  const loaded = await withTenant(tenantId, (tx) => loadConnection(tx, kind));
  if (!loaded) throw new UserError("Not connected.");
  if (!loaded.connector.registerWebhook) throw new UserError("This integration does not use webhooks.");
  const webhookSecret = randomToken(32);
  try {
    await loaded.connector.registerWebhook(loaded.conn, webhookUrl(loaded.integration.id), webhookSecret);
  } catch (e) {
    userFacing(e);
  }
  await withTenant(tenantId, async (tx) => {
    await tx.query(
      "update integrations set secrets = $1, status = 'connected', last_error = null, updated_at = now() where id = $2",
      [seal({ ...loaded.conn.secrets, webhookSecret }), loaded.integration.id],
    );
    await logEvent(tx, loaded.integration.id, { direction: "out", topic: "webhook.register", status: "ok", summary: "Webhook secret rotated" });
  });
}

/**
 * Disconnect: forget the credentials and hide the products that came from it.
 * The rows stay, so reconnecting brings the same products back rather than
 * minting new ids that old orders no longer point at.
 */
export async function disconnectIntegration(tenantId: string, kind: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const row = await tx.one<{ id: string }>(
      "update integrations set status = 'disconnected', secrets = null, updated_at = now() where kind = $1 returning id",
      [kind],
    );
    if (!row) throw new NotFound("integration not found");
    if (kind === "zuuvy") {
      await tx.query("update products set active = false, updated_at = now() where source = 'zuuvy'");
    }
    await logEvent(tx, row.id, { direction: "out", topic: "disconnect", status: "ok", summary: "Disconnected" });
  });
}
