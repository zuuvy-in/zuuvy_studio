"use server";

import {
  UserError,
  createSite,
  generateVersion,
  getVersionByNumber,
  publishVersion,
  renameSite,
  restoreVersion,
  withTenant,
} from "@zsite/platform";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, attempt } from "@/lib/actions";
import { requireSession } from "@/lib/session";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function createSiteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  return attempt(async () => {
    const site = await withTenant(session.tenant.id, (tx) =>
      createSite(tx, {
        name: text(form, "name"),
        subdomain: text(form, "subdomain"),
        templateId: text(form, "template"),
        templateInput: {
          businessName: session.tenant.name,
          tagline: text(form, "tagline") || undefined,
          email: session.user.email,
        },
        userId: session.user.id,
      }),
    );
    redirect(`/sites/${site.id}/versions`);
  });
}

export async function publishAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const number = Number(text(form, "number"));
    await withTenant(session.tenant.id, async (tx) => {
      const v = await getVersionByNumber(tx, siteId, number);
      await publishVersion(tx, siteId, v.id, session.user.id);
    });
    revalidatePath(`/sites/${siteId}`, "layout");
    return { ok: `Version ${number} is live.` };
  });
}

export async function restoreAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const number = Number(text(form, "number"));
    const created = await withTenant(session.tenant.id, async (tx) => {
      const v = await getVersionByNumber(tx, siteId, number);
      return restoreVersion(tx, siteId, v.id, session.user.id);
    });
    revalidatePath(`/sites/${siteId}`, "layout");
    redirect(`/sites/${siteId}/versions/${created.number}`);
  });
}

export async function generateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const baseNumber = Number(text(form, "base"));
    const base = await withTenant(session.tenant.id, (tx) => getVersionByNumber(tx, siteId, baseNumber));
    const created = await generateVersion(session.tenant.id, {
      siteId,
      baseVersionId: base.id,
      prompt: text(form, "prompt"),
      userId: session.user.id,
    });
    revalidatePath(`/sites/${siteId}`, "layout");
    redirect(`/sites/${siteId}/versions/${created.number}`);
  });
}

export async function renameAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const name = text(form, "name");
    if (!name) throw new UserError("Give the site a name.");
    await withTenant(session.tenant.id, (tx) => renameSite(tx, siteId, name));
    revalidatePath(`/sites/${siteId}`, "layout");
    return { ok: "Saved." };
  });
}
