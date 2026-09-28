import type { AlertSettings } from "@zsite/platform";
import { ActionForm, SubmitButton } from "@/components/forms";
import { alertsAction } from "./actions";

export function AlertsForm({ alerts, next, submit = "Save" }: { alerts: AlertSettings; next?: string; submit?: string }) {
  return (
    <ActionForm action={alertsAction} className="space-y-4 p-5">
      {next && <input type="hidden" name="next" value={next} />}
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="orders" value="1" defaultChecked={alerts.orders} className="mt-1" />
        <span>
          <strong className="text-slate-900">Email me when a new order comes in</strong>
          <br />
          <span className="text-slate-600">Sent from alerts@zuuvy.site the moment a customer orders, with a link to accept it.</span>
        </span>
      </label>
      <div>
        <label className="label" htmlFor="emails">Send alerts to</label>
        <textarea id="emails" name="emails" rows={2} defaultValue={alerts.emails.join("\n")} className="field" placeholder="you@business.in, partner@business.in" />
        <p className="help">Up to 10 addresses, one per line or separated by commas.</p>
      </div>
      <SubmitButton pending="Saving…">{submit}</SubmitButton>
    </ActionForm>
  );
}
