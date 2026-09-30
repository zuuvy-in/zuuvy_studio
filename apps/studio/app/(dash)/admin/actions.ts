"use server";

import { addPlatformAdmin, removePlatformAdmin, removeShowcase, setShowcase } from "@zsite/platform";
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

export async function saveShowcaseAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePlatformAdmin();
  return attempt(async () => {
    await setShowcase(session.user.id, {
      siteId: text(form, "siteId"),
      slug: text(form, "slug"),
      title: text(form, "title"),
      category: text(form, "category"),
      description: text(form, "description"),
      coverUrl: text(form, "cover") || null,
      sort: Number(text(form, "sort")) || 0,
      active: form.get("active") === "1",
      sampleBusiness: text(form, "sample"),
    });
    revalidatePath("/admin/templates");
    revalidatePath("/sites/new");
    return { ok: "Saved." };
  });
}

export async function removeShowcaseAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePlatformAdmin();
  return attempt(async () => {
    await removeShowcase(session.user.id, text(form, "id"));
    revalidatePath("/admin/templates");
    return { ok: "No longer offered. The site itself is untouched." };
  });
}
