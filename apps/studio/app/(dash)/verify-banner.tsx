import { ActionForm, SubmitButton } from "@/components/forms";
import { resendVerificationAction } from "./verify-actions";

/** Shown until the owner confirms their email; publishing waits for it. */
export function VerifyBanner({ email }: { email: string }) {
  return (
    <div className="mb-6 flex flex-col gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200 sm:flex-row sm:items-center sm:justify-between">
      <p>
        <strong>Confirm your email to go live.</strong> We sent a link to {email}. You can build and preview meanwhile; publishing waits for it.
      </p>
      <ActionForm action={resendVerificationAction} className="shrink-0">
        <SubmitButton variant="secondary" size="sm" pending="Sending…">Send the link again</SubmitButton>
      </ActionForm>
    </div>
  );
}
