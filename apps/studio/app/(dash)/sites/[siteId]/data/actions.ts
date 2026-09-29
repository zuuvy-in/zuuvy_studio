"use server";

import { type ImportMode, deleteRows, deleteSiteTable, getSiteTable, importRows, setTableNotify, withTenant } from "@zsite/platform";
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
    revalidatePath(`/sites/${siteId}/data`, "layout");
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
    revalidatePath(`/sites/${siteId}/data`, "layout");
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
    redirect(`/sites/${siteId}/data`);
  });
}

export async function importRowsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return { error: "Choose a CSV file first." };
    if (file.size > 5_000_000) return { error: "That file is over 5 MB — split it into smaller files." };
    const csv = await file.text();
    const mode = (text(form, "mode") || "append") as ImportMode;
    const matchOn = form.getAll("matchOn").map(String).filter((k) => k && k !== "_row");
    const r = await withTenant(session.tenant.id, async (tx) => importRows(tx, await getSiteTable(tx, siteId, text(form, "tableId")), csv, { mode, matchOn }));
    revalidatePath(`/sites/${siteId}/data`, "layout");
    const rows = (n: number) => `${n} ${n === 1 ? "row" : "rows"}`;
    const parts = [
      r.removed && `removed ${rows(r.removed)} that were there`,
      r.added && `added ${rows(r.added)}`,
      r.updated && `updated ${rows(r.updated)}`,
      mode === "skip" && r.duplicates && `left out ${r.duplicates} ${r.duplicates === 1 ? "duplicate" : "duplicates"}`,
    ].filter(Boolean);
    const skipped = r.skipped.length ? ` Could not read ${rows(r.skipped.length)}: ${r.skipped.slice(0, 3).map((s) => `line ${s.line} — ${s.reason}`).join("; ")}${r.skipped.length > 3 ? "…" : ""}` : "";
    if (!parts.length) return { error: `Nothing changed.${skipped}` };
    const said = parts.join(", ");
    return { ok: `${said[0]!.toUpperCase()}${said.slice(1)}.${skipped}` };
  });
}
