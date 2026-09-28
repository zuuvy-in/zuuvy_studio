import { listPlatformAdmins } from "@zsite/platform";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { ago } from "@/lib/format";
import { requirePlatformAdmin } from "@/lib/session";
import { addAdminAction, removeAdminAction } from "../actions";
import { AdminTabs } from "../nav";

export const metadata = { title: "Platform admins" };

export default async function AdminsPage() {
  const session = await requirePlatformAdmin();
  const admins = await listPlatformAdmins();
  const superadmin = session.platformRole === "superadmin";
  return (
    <>
      <PageHeader eyebrow="Zuuvy Sites" title="Platform admin" description="Who can open this panel. Admins see everything here; superadmins can also add and remove admins." />
      <AdminTabs />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title={`Admins (${admins.length})`} />
          <ul className="divide-y divide-slate-100">
            {admins.map((a) => (
              <li key={a.user_id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{a.name} {a.user_id === session.user.id && <span className="text-xs font-normal text-slate-500">(you)</span>}</p>
                  <p className="text-xs text-slate-500">{a.email} · added {ago(a.created_at)}{a.added_by ? ` by ${a.added_by}` : " by the setup script"}</p>
                </div>
                <Badge tone={a.role === "superadmin" ? "violet" : "gray"}>{a.role}</Badge>
                {superadmin && a.user_id !== session.user.id && (
                  <ActionForm action={removeAdminAction}>
                    <input type="hidden" name="userId" value={a.user_id} />
                    <SubmitButton size="sm" variant="danger" pending="…" confirm={`Remove ${a.email} as a platform admin?`}>Remove</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Add an admin" description={superadmin ? "An existing account is promoted. A new email gets an account and a one-time password." : "Only a superadmin can add admins."} />
          <ActionForm action={addAdminAction} className="space-y-3 p-5" resetOnOk>
            <input name="email" type="email" required placeholder="name@zuuvy.in" className="field" disabled={!superadmin} />
            <input name="name" placeholder="Name (for a new account)" className="field" disabled={!superadmin} />
            <select name="role" className="field" disabled={!superadmin}>
              <option value="admin">Admin — can view the panel</option>
              <option value="superadmin">Superadmin — can also manage admins</option>
            </select>
            <SubmitButton pending="Adding…">Add admin</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
