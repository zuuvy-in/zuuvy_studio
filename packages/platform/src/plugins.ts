/**
 * Plugins: outside services a business connects to its cart and checkout —
 * a loyalty scheme, a delivery-slot picker, a GST-invoice step, a gift note.
 * Each plugin is an https address and the hooks it wants:
 *
 *   cart.calculate    → { adjustments: [{ label, amount }], messages: [{ text, tone }] }
 *                        amount in rupees, negative for money off, positive for a fee
 *   checkout.fields   → { fields: [{ name, label, type, required, options, help }] }
 *                        extra questions at checkout; answers are stored on the order
 *   checkout.validate → { ok: true } or { ok: false, error: "…" }  — can stop an order
 *   order.placed      → anything; told after the order exists (through the outbox, retried)
 *
 * Every call is a POST of `{ hook, site, cart | order, … }` signed with the
 * plugin's secret: `X-Zuuvy-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`.
 *
 * A plugin can shape a sale but never break one: a plugin that is slow, down
 * or answers nonsense is skipped (and its error kept for the business to see),
 * answers are bounded, and no adjustment can take a total below zero.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { type Tx, UserError, isUuid, withTenant } from "./db";
import { checkPluginUrl, postJson } from "./references";
import { open, randomToken, seal } from "./secrets";

export const HOOKS = ["cart.calculate", "checkout.fields", "checkout.validate", "order.placed"] as const;
export type Hook = (typeof HOOKS)[number];

export type Plugin = {
  id: string;
  /** The store it takes part in; null = every store. */
  site_id: string | null;
  name: string;
  url: string;
  hooks: Hook[];
  active: boolean;
  last_error: string | null;
  last_called_at: Date | null;
  created_at: Date;
};

const COLUMNS = "id, name, url, hooks, active, last_error, last_called_at, created_at, site_id";

export type Adjustment = { plugin: string; label: string; amount: number };
export type PluginMessage = { plugin: string; text: string; tone: "info" | "success" | "warning" };
export type CheckoutField = {
  plugin: string;
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "checkbox" | "date";
  required: boolean;
  options: string[];
  help: string | null;
};

const CalculateAnswer = z.object({
  adjustments: z.array(z.object({ label: z.string().min(1).max(60), amount: z.number().finite() })).max(5).default([]),
  messages: z.array(z.object({ text: z.string().min(1).max(200), tone: z.enum(["info", "success", "warning"]).default("info") })).max(5).default([]),
});
const FieldsAnswer = z.object({
  fields: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
        label: z.string().min(1).max(60),
        type: z.enum(["text", "textarea", "select", "checkbox", "date"]).default("text"),
        required: z.boolean().default(false),
        options: z.array(z.string().max(60)).max(20).default([]),
        help: z.string().max(200).nullable().default(null),
      }),
    )
    .max(6)
    .default([]),
});
const ValidateAnswer = z.object({ ok: z.boolean(), error: z.string().max(200).optional() });

/** How requests leave. Replaced in tests; production posts through the guarded client. */
export type PluginTransport = (url: string, body: string, headers: Record<string, string>) => Promise<{ status: number; json: unknown }>;
let transport: PluginTransport = (url, body, headers) => postJson(url, body, headers);
export function setPluginTransport(t: PluginTransport | undefined): void {
  transport = t ?? ((url, body, headers) => postJson(url, body, headers));
}

export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

type Loaded = Plugin & { secret: string };

async function pluginsFor(tenantId: string, hook: Hook, siteId?: string | null): Promise<Loaded[]> {
  return withTenant(tenantId, (tx) =>
    tx.query<Loaded>(`select ${COLUMNS}, secret from plugins where active and hooks ? $1 and (site_id is null or site_id = $2) order by created_at`, [hook, siteId ?? null]),
  );
}

async function call(tenantId: string, p: Loaded, hook: Hook, payload: Record<string, unknown>): Promise<unknown | null> {
  const body = JSON.stringify({ hook, ...payload });
  let error: string | null = null;
  let json: unknown = null;
  try {
    const secret = open<{ secret: string }>(p.secret).secret;
    json = (await transport(p.url, body, { "x-zuuvy-hook": hook, "x-zuuvy-signature": sign(secret, body) })).json;
  } catch (e) {
    error = `${hook}: ${(e as Error).message}`.slice(0, 300);
  }
  await withTenant(tenantId, (tx) =>
    tx.query("update plugins set last_called_at = now(), last_error = coalesce($2, last_error) where id = $1", [p.id, error]),
  ).catch(() => {});
  if (error) console.warn(`plugin ${p.name} skipped: ${error}`);
  return error ? null : json;
}

async function each<T>(tenantId: string, hook: Hook, payload: Record<string, unknown>, schema: z.ZodType<T>, siteId?: string | null): Promise<{ plugin: Loaded; answer: T }[]> {
  const plugins = await pluginsFor(tenantId, hook, siteId);
  const answers = await Promise.all(
    plugins.map(async (p) => {
      const json = await call(tenantId, p, hook, payload);
      if (json === null) return null;
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        await withTenant(tenantId, (tx) => tx.query("update plugins set last_error = $2 where id = $1", [p.id, `${hook}: the answer did not match the contract`]));
        return null;
      }
      return { plugin: p, answer: parsed.data };
    }),
  );
  return answers.filter((a): a is { plugin: Loaded; answer: T } => a !== null);
}

/** Adjustments and messages for a cart. Amounts are bounded by the subtotal; the caller keeps the total at or above zero. */
export async function calculateHooks(tenantId: string, payload: Record<string, unknown>, subtotal: number, siteId?: string | null) {
  const answers = await each(tenantId, "cart.calculate", payload, CalculateAnswer, siteId);
  const adjustments: Adjustment[] = [];
  const messages: PluginMessage[] = [];
  for (const { plugin, answer } of answers) {
    for (const a of answer.adjustments) {
      const amount = Math.round(Math.max(-subtotal, Math.min(subtotal, a.amount)) * 100) / 100;
      if (amount !== 0) adjustments.push({ plugin: plugin.name, label: a.label, amount });
    }
    for (const m of answer.messages) messages.push({ plugin: plugin.name, text: m.text, tone: m.tone });
  }
  return { adjustments, messages };
}

export async function checkoutFields(tenantId: string, payload: Record<string, unknown>, siteId?: string | null): Promise<CheckoutField[]> {
  const answers = await each(tenantId, "checkout.fields", payload, FieldsAnswer, siteId);
  const taken = new Set<string>();
  const out: CheckoutField[] = [];
  for (const { plugin, answer } of answers) {
    for (const f of answer.fields) {
      if (taken.has(f.name)) continue;
      taken.add(f.name);
      out.push({ plugin: plugin.name, ...f });
    }
  }
  return out;
}

/** The first refusal, in the plugin's words; null when every plugin is content (or unreachable). */
export async function validateHooks(tenantId: string, payload: Record<string, unknown>, siteId?: string | null): Promise<string | null> {
  const answers = await each(tenantId, "checkout.validate", payload, ValidateAnswer, siteId);
  const no = answers.find((a) => !a.answer.ok);
  return no ? no.answer.error || `${no.plugin.name} could not accept this order.` : null;
}

/** Answers to plugin questions, checked against the questions asked. */
export function readFieldAnswers(fields: CheckoutField[], raw: (name: string) => string): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const f of fields) {
    const v = raw(`x_${f.name}`).trim();
    if (f.type === "checkbox") {
      if (f.required && !v) throw new UserError(`Please tick “${f.label}”.`);
      out[f.name] = Boolean(v);
      continue;
    }
    if (f.required && !v) throw new UserError(`Please fill in “${f.label}”.`);
    if (f.type === "select" && v && !f.options.includes(v)) throw new UserError(`Choose one of the options for “${f.label}”.`);
    if (v) out[f.name] = v.slice(0, 500);
  }
  return out;
}

/** order.placed, from the outbox: failures are retried there. */
export async function notifyOrderPlaced(tenantId: string, pluginId: string, orderId: string): Promise<void> {
  const loaded = await withTenant(tenantId, async (tx) => {
    const p = await tx.one<Loaded>(`select ${COLUMNS}, secret from plugins where id = $1 and active`, [pluginId]);
    const order = await tx.one(
      "select id, number, status, customer, lines, subtotal::float8, discount::float8, total::float8, discounts, adjustments, extra, created_at from orders where id = $1",
      [orderId],
    );
    return p && order ? { p, order } : null;
  });
  if (!loaded) return;
  const body = JSON.stringify({ hook: "order.placed", order: loaded.order });
  const secret = open<{ secret: string }>(loaded.p.secret).secret;
  await transport(loaded.p.url, body, { "x-zuuvy-hook": "order.placed", "x-zuuvy-signature": sign(secret, body) });
}

// ---------------------------------------------------------------------------
// Management
// ---------------------------------------------------------------------------

function cleanInput(input: { name: string; url: string; hooks: string[] }) {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new UserError("Give the plugin a name.");
  const url = checkPluginUrl(input.url.trim()).href;
  const hooks = HOOKS.filter((h) => input.hooks.includes(h));
  if (!hooks.length) throw new UserError("Choose at least one thing the plugin takes part in.");
  return { name, url, hooks };
}

export async function listPlugins(tx: Tx, siteId?: string): Promise<Plugin[]> {
  return tx.query<Plugin>(`select ${COLUMNS} from plugins ${siteId ? "where site_id is null or site_id = $1" : ""} order by created_at`, siteId ? [siteId] : []);
}

/** Returns the signing secret once; it is stored sealed and never shown again. */
export async function createPlugin(
  tx: Tx,
  input: { name: string; url: string; hooks: string[]; siteId?: string | null },
): Promise<{ plugin: Plugin; secret: string }> {
  const p = cleanInput(input);
  const secret = `zsp_${randomToken(24)}`;
  const plugin = await tx.get<Plugin>(
    `insert into plugins (tenant_id, name, url, hooks, secret, site_id) values (app_tenant(), $1, $2, $3, $4, $5) returning ${COLUMNS}`,
    [p.name, p.url, JSON.stringify(p.hooks), seal({ secret }), input.siteId ?? null],
  );
  return { plugin, secret };
}

export async function updatePlugin(tx: Tx, id: string, input: { name: string; url: string; hooks: string[]; active: boolean }): Promise<void> {
  if (!isUuid(id)) throw new UserError("That plugin does not exist.");
  const p = cleanInput(input);
  await tx.get(
    "update plugins set name = $2, url = $3, hooks = $4, active = $5, last_error = null where id = $1 returning id",
    [id, p.name, p.url, JSON.stringify(p.hooks), input.active],
    "plugin",
  );
}

export async function rotatePluginSecret(tx: Tx, id: string): Promise<string> {
  if (!isUuid(id)) throw new UserError("That plugin does not exist.");
  const secret = `zsp_${randomToken(24)}`;
  await tx.get("update plugins set secret = $2 where id = $1 returning id", [id, seal({ secret })], "plugin");
  return secret;
}

export async function deletePlugin(tx: Tx, id: string): Promise<void> {
  if (!isUuid(id)) throw new UserError("That plugin does not exist.");
  await tx.get("delete from plugins where id = $1 returning id", [id], "plugin");
}

/** Plugins told about new orders; the order's transaction queues one job each. */
export async function orderPlacedPlugins(tx: Tx, siteId?: string | null): Promise<string[]> {
  return (
    await tx.query<{ id: string }>("select id from plugins where active and hooks ? 'order.placed' and (site_id is null or site_id = $1)", [siteId ?? null])
  ).map((r) => r.id);
}
