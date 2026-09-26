import "server-only";
import { NotFound, UserError } from "@zsite/platform";
import { unstable_rethrow } from "next/navigation";

export type ActionState = { error?: string; ok?: string } | null;

/**
 * Runs an action body and turns refusals meant for people into a message on
 * the form. Anything else is a bug and is rethrown to the error boundary.
 * Next's redirect() works by throwing; unstable_rethrow lets it through.
 */
export async function attempt(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? null;
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof UserError) return { error: e.message };
    if (e instanceof NotFound) return { error: "That no longer exists." };
    throw e;
  }
}
