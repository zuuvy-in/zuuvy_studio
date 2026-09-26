"use server";

import {
  connectIntegration,
  disconnectIntegration,
  rotateWebhookSecret,
  syncCatalog,
  testIntegration,
} from "@zsite/platform";
import { revalidatePath } from "next/cache";
import { type ActionState, attempt } from "@/lib/actions";
import { requireSession } from "@/lib/session";

const kindOf = (f: FormData) => String(f.get("kind") ?? "");

export async function connectAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (session.role === "editor") return { error: "Only owners and admins can connect integrations." };
  return attempt(async () => {
    const kind = kindOf(form);
    const input: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (typeof v === "string" && k !== "kind" && !k.startsWith("$")) input[k] = v;
    const r = await connectIntegration(session.tenant.id, kind, input, { syncNow: true });
    revalidatePath("/", "layout");
    return r.warning ? { error: r.warning } : { ok: `Connected to ${r.info.headline}.` };
  });
}

export async function testAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  return attempt(async () => {
    const info = await testIntegration(session.tenant.id, kindOf(form));
    revalidatePath(`/integrations/${kindOf(form)}`);
    return { ok: `Reached ${info.headline}.` };
  });
}

export async function syncAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  return attempt(async () => {
    const full = form.get("full") === "1";
    const r = await syncCatalog(session.tenant.id, { kind: kindOf(form), full });
    revalidatePath("/", "layout");
    return { ok: `${r.full ? "Full" : "Incremental"} sync: ${r.updated} product${r.updated === 1 ? "" : "s"} updated${r.hidden ? `, ${r.hidden} hidden` : ""}.` };
  });
}

export async function rotateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (session.role === "editor") return { error: "Only owners and admins can do this." };
  return attempt(async () => {
    await rotateWebhookSecret(session.tenant.id, kindOf(form));
    revalidatePath(`/integrations/${kindOf(form)}`);
    return { ok: "New webhook secret registered. The old one no longer works." };
  });
}

export async function disconnectAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (session.role === "editor") return { error: "Only owners and admins can disconnect integrations." };
  return attempt(async () => {
    await disconnectIntegration(session.tenant.id, kindOf(form));
    revalidatePath("/", "layout");
    return { ok: "Disconnected. Its products are hidden from your store until you reconnect." };
  });
}
