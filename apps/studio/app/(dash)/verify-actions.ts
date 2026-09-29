"use server";

import { sendEmailVerification } from "@zsite/platform";
import { type ActionState, attempt } from "@/lib/actions";
import { requireSession } from "@/lib/session";

export async function resendVerificationAction(_: ActionState): Promise<ActionState> {
  const session = await requireSession();
  return attempt(async () => {
    const { sent } = await sendEmailVerification(session.tenant.id, session.user.id);
    return sent ? { ok: `Sent to ${session.user.email}. It can take a minute; check spam too.` } : { ok: "Your email is already confirmed." };
  });
}
