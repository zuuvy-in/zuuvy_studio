import { CURRENT_RUNTIME, getSite, withTenant } from "@zsite/platform";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, Dl } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { renameAction } from "../../actions";

export const metadata = { title: "Site settings" };

export default async function SettingsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const session = await requireSession();
  const site = await withTenant(session.tenant.id, (tx) => getSite(tx, siteId));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="General" />
        <ActionForm action={renameAction} className="space-y-4 p-5">
          <input type="hidden" name="siteId" value={site.id} />
          <div>
            <label className="label" htmlFor="name">Site name</label>
            <input id="name" name="name" defaultValue={site.name} className="field" required />
          </div>
          <SubmitButton pending="Saving…">Save</SubmitButton>
        </ActionForm>
      </Card>

      <Card>
        <CardHeader title="Address" description="Where customers find this site." />
        <Dl items={[["Zuuvy address", site.url.replace(/^https?:\/\//, "")], ["Custom domain", <Badge key="d">Coming next</Badge>]]} />
        <p className="px-5 pb-5 text-xs text-slate-500">
          Connecting your own domain — bought here through AWS Route 53, or one you already own via your registrar — comes in the next release.
        </p>
      </Card>

      <Card>
        <CardHeader title="Runtime" description="The component library this site renders with. You choose when to upgrade." />
        <Dl
          items={[
            ["Current", `Runtime ${site.runtime_version}`],
            ["Newest available", `Runtime ${CURRENT_RUNTIME}`],
            ["Status", site.runtime_version === CURRENT_RUNTIME ? <Badge key="s" tone="green">Up to date</Badge> : <Badge key="s" tone="amber">Upgrade available</Badge>],
          ]}
        />
        <p className="px-5 pb-5 text-xs text-slate-500">
          When a new runtime ships, upgrading creates a new version migrated to it, which you preview and publish like any other — and can roll back.
        </p>
      </Card>

      <Card>
        <CardHeader title="Details" />
        <Dl items={[["Kind", site.kind], ["Created", dateTime(site.created_at)], ["Versions", String(site.latest_number)], ["Site id", <code key="i" className="text-xs">{site.id}</code>]]} />
      </Card>
    </div>
  );
}
