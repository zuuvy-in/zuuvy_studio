"use server";

import { advanceOrder, retryOrderSync } from "@zsite/platform";
import { revalidatePath } from "next/cache";
import { type ActionState, attempt } from "@/lib/actions";
import { formScope } from "@/lib/scope";
import { requireSession } from "@/lib/session";

export async function retrySyncAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const scope = formScope(form);
  return attempt(async () => {
    const id = String(form.get("orderId") ?? "");
    await retryOrderSync(session.tenant.id, id);
    revalidatePath(`${scope.base}/orders/${id}`);
    return { ok: "Queued — it will be sent within a few seconds." };
  });
}

export async function advanceAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const scope = formScope(form);
  return attempt(async () => {
    const id = String(form.get("orderId") ?? "");
    const to = String(form.get("to") ?? "") as Parameters<typeof advanceOrder>[2];
    await advanceOrder(session.tenant.id, id, to);
    revalidatePath(`${scope.base}/orders/${id}`);
    revalidatePath(`${scope.base}/orders`);
    return { ok: "Updated. The customer's tracking page shows it now." };
  });
}
