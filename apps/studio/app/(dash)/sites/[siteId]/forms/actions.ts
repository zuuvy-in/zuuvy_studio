"use server";

import { deleteRows, deleteSiteTable, getSiteTable, setTableNotify, withTenant } from "@zsite/platform";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, attempt } from "@/lib/actions";
import { requireSession } from "@/lib/session";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function notifyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const on = form.get("notify") === "1";
    await withTenant(session.tenant.id, (tx) => setTableNotify(tx, siteId, text(form, "tableId"), on));
    revalidatePath(`/sites/${siteId}/forms`, "layout");
    return { ok: on ? "You will get an email for each new answer." : "No more emails for this form." };
  });
}

export async function deleteRowsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const ids = form.getAll("row").map(Number).filter(Number.isInteger);
    if (!ids.length) return { error: "Tick the answers to delete first." };
    await withTenant(session.tenant.id, async (tx) => {
      const table = await getSiteTable(tx, siteId, text(form, "tableId"));
      await deleteRows(tx, table.id, ids);
    });
    revalidatePath(`/sites/${siteId}/forms`, "layout");
    return { ok: `Deleted ${ids.length} ${ids.length === 1 ? "answer" : "answers"}.` };
  });
}

/** Deletes a table and every answer in it — also how an AI's proposed deletion is carried out. */
export async function deleteTableAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    await withTenant(session.tenant.id, (tx) => deleteSiteTable(tx, siteId, text(form, "table")));
    revalidatePath(`/sites/${siteId}`, "layout");
    const back = text(form, "back");
    if (back.startsWith(`/sites/${siteId}/`)) return { ok: "Deleted the table and its answers." };
    redirect(`/sites/${siteId}/forms`);
  });
}
