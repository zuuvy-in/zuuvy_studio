"use server";

import { UserError, createPlugin, deletePlugin, rotatePluginSecret, updatePlugin, withTenant } from "@zsite/platform";
import { revalidatePath } from "next/cache";
import { type ActionState, attempt } from "@/lib/actions";
import { formScope, ownSiteId } from "@/lib/scope";
import { requireSession } from "@/lib/session";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Plugins decide money on the storefront, so only owners and admins manage them. */
async function manager() {
  return requireSession();
}
function mayManage(role: string) {
  if (role === "editor") throw new UserError("Only an owner or admin can manage plugins.");
}

export async function createPluginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await manager();
  const scope = formScope(form);
  return attempt(async () => {
    mayManage(session.role);
    const { secret } = await withTenant(session.tenant.id, async (tx) =>
      createPlugin(tx, { name: text(form, "name"), url: text(form, "url"), hooks: form.getAll("hooks").map(String), siteId: await ownSiteId(tx, scope) }),
    );
    revalidatePath(`${scope.base}/plugins`);
    return { ok: `Connected. Its signing secret is ${secret} — give it to the plugin now; it is not shown again.` };
  });
}

export async function updatePluginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await manager();
  const scope = formScope(form);
  return attempt(async () => {
    mayManage(session.role);
    await withTenant(session.tenant.id, (tx) =>
      updatePlugin(tx, text(form, "id"), {
        name: text(form, "name"),
        url: text(form, "url"),
        hooks: form.getAll("hooks").map(String),
        active: form.get("active") === "1",
      }),
    );
    revalidatePath(`${scope.base}/plugins`);
    return { ok: "Saved." };
  });
}

export async function rotateSecretAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await manager();
  return attempt(async () => {
    mayManage(session.role);
    const secret = await withTenant(session.tenant.id, (tx) => rotatePluginSecret(tx, text(form, "id")));
    return { ok: `New signing secret: ${secret} — the old one stops working now.` };
  });
}

export async function deletePluginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await manager();
  const scope = formScope(form);
  return attempt(async () => {
    mayManage(session.role);
    await withTenant(session.tenant.id, (tx) => deletePlugin(tx, text(form, "id")));
    revalidatePath(`${scope.base}/plugins`);
    return { ok: "Removed." };
  });
}
