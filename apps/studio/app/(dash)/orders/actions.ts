"use server";

import { retryOrderSync } from "@zsite/platform";
import { revalidatePath } from "next/cache";
import { type ActionState, attempt } from "@/lib/actions";
import { requireSession } from "@/lib/session";

export async function retrySyncAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  return attempt(async () => {
    const id = String(form.get("orderId") ?? "");
    await retryOrderSync(session.tenant.id, id);
    revalidatePath(`/orders/${id}`);
    return { ok: "Queued — it will be sent within a few seconds." };
  });
}
