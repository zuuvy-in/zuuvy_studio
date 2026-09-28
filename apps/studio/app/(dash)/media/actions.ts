"use server";

import { UserError, deleteAsset, generateAsset, updateAssetAlt, uploadAsset, withTenant } from "@zsite/platform";
import { revalidatePath } from "next/cache";
import { type ActionState, attempt } from "@/lib/actions";
import { requireSession } from "@/lib/session";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function uploadAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  return attempt(async () => {
    const files = form.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0);
    if (!files.length) throw new UserError("Choose one or more pictures.");
    if (files.length > 10) throw new UserError("Upload up to 10 pictures at a time.");
    for (const f of files) {
      await uploadAsset(session.tenant.id, { bytes: new Uint8Array(await f.arrayBuffer()), alt: text(form, "alt") || f.name.replace(/\.[^.]+$/, ""), userId: session.user.id });
    }
    revalidatePath("/media");
    return { ok: `${files.length} picture${files.length === 1 ? "" : "s"} added. The AI can use them now.` };
  });
}

export async function generateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  return attempt(async () => {
    const prompt = text(form, "prompt");
    if (prompt.length < 10) throw new UserError("Describe the picture in a sentence or two.");
    const aspect = (["wide", "landscape", "square", "portrait"].includes(text(form, "aspect")) ? text(form, "aspect") : "landscape") as "landscape";
    const style = (["photo", "illustration", "3d", "flat"].includes(text(form, "style")) ? text(form, "style") : "photo") as "photo";
    await generateAsset(session.tenant.id, { prompt: prompt.slice(0, 900), aspect, style, userId: session.user.id });
    revalidatePath("/media");
    return { ok: "Picture created." };
  });
}

export async function altAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  return attempt(async () => {
    await withTenant(session.tenant.id, (tx) => updateAssetAlt(tx, text(form, "id"), text(form, "alt")));
    revalidatePath("/media");
    return { ok: "Saved." };
  });
}

export async function deleteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  return attempt(async () => {
    await deleteAsset(session.tenant.id, text(form, "id"));
    revalidatePath("/media");
    return { ok: "Deleted." };
  });
}
