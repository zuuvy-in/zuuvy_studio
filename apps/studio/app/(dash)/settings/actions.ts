"use server";

import { setAlerts, withTenant } from "@zsite/platform";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, attempt } from "@/lib/actions";
import { requireSession } from "@/lib/session";

export async function alertsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  return attempt(async () => {
    const emails = String(form.get("emails") ?? "").split(/[\s,;]+/);
    await withTenant(session.tenant.id, (tx) => setAlerts(tx, { orders: form.get("orders") === "1", emails }));
    revalidatePath("/settings");
    const next = String(form.get("next") ?? "");
    // Only a path on this site: a form field must not be able to send someone elsewhere.
    if (next.startsWith("/") && !next.startsWith("//")) redirect(next);
    return { ok: "Saved." };
  });
}
