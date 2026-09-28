import { getAlerts, withTenant } from "@zsite/platform";
import { Card, CardHeader, Dl, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { AlertsForm } from "./alerts-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireSession();
  const alerts = await withTenant(session.tenant.id, getAlerts);
  return (
    <>
      <PageHeader title="Settings" description={`${session.tenant.name} — how Zuuvy Sites keeps you informed.`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Order alerts" />
          <AlertsForm alerts={alerts} />
        </Card>
        <Card>
          <CardHeader title="Account" />
          <Dl items={[["Business", session.tenant.name], ["You", `${session.user.name} (${session.user.email})`], ["Role", session.role]]} />
          <p className="px-5 pb-5 text-xs text-slate-500">Account emails (welcome, a domain connected) come from no-reply@zuuvy.site.</p>
        </Card>
      </div>
    </>
  );
}
