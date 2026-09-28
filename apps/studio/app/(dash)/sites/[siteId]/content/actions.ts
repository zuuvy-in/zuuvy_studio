"use server";

import { type DataOp, collectionSpec } from "@zsite/core";
import { UserError, editData, withTenant } from "@zsite/platform";
import { revalidatePath } from "next/cache";
import { type ActionState, attempt } from "@/lib/actions";
import { requireSession } from "@/lib/session";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Form fields → an entry, by the collection's field spec. Empty means "not set". */
function fieldsFrom(form: FormData, collection: string): Record<string, unknown> {
  const spec = collectionSpec(collection);
  if (!spec) throw new UserError("Unknown collection.");
  const out: Record<string, unknown> = {};
  for (const f of spec.fields) {
    const raw = text(form, `f_${f.key}`);
    if (!raw) {
      out[f.key] = null;
      continue;
    }
    if (f.kind === "tags") out[f.key] = raw.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 12);
    else if (f.kind === "year") out[f.key] = Number(raw);
    else out[f.key] = raw;
  }
  return out;
}

async function save(form: FormData, op: (collection: string) => DataOp, ok: string): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const collection = text(form, "collection");
    const v = await withTenant(session.tenant.id, (tx) => editData(tx, siteId, [op(collection)], session.user.id));
    revalidatePath(`/sites/${siteId}`, "layout");
    return { ok: `${ok} Saved as version ${v.number} — publish it from Versions when you are ready.` };
  });
}

export async function saveEntryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = text(form, "id");
  return save(
    form,
    (collection) => {
      const fields = fieldsFrom(form, collection);
      const spec = collectionSpec(collection)!;
      if (id || (spec.single && text(form, "exists"))) return { op: "updateItem", collection, id: id || undefined, fields };
      const item = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null));
      return { op: "addItem", collection, item };
    },
    id ? "Updated." : "Added.",
  );
}

export async function removeEntryAction(_: ActionState, form: FormData): Promise<ActionState> {
  return save(form, (collection) => ({ op: "removeItem", collection, id: text(form, "id") || undefined }), "Removed.");
}

export async function moveEntryAction(_: ActionState, form: FormData): Promise<ActionState> {
  return save(form, (collection) => ({ op: "moveItem", collection, id: text(form, "id"), index: Number(text(form, "index")) }), "Moved.");
}
