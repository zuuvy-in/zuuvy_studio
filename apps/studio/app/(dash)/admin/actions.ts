"use server";

import { addPlatformAdmin, removePlatformAdmin } from "@zsite/platform";
import { revalidatePath } from "next/cache";
import { type ActionState, attempt } from "@/lib/actions";
import { requirePlatformAdmin } from "@/lib/session";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function addAdminAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePlatformAdmin();
  return attempt(async () => {
    const role = text(form, "role") === "superadmin" ? "superadmin" : "admin";
    const r = await addPlatformAdmin(session.user.id, { email: text(form, "email"), name: text(form, "name"), role });
    revalidatePath("/admin/admins");
    return {
      ok: r.created
        ? `Created ${r.email} as ${role}. Their password (shown once — send it privately): ${r.password}`
        : `${r.email} is now a ${role}.`,
    };
  });
}

export async function removeAdminAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePlatformAdmin();
  return attempt(async () => {
    await removePlatformAdmin(session.user.id, text(form, "userId"));
    revalidatePath("/admin/admins");
    return { ok: "Removed. Their account and businesses are untouched." };
  });
}
