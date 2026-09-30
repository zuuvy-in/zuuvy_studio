import { listShowcases, listSites, withTenant } from "@zsite/platform";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/session";
import { removeShowcaseAction, saveShowcaseAction } from "../actions";
import { AdminTabs } from "../nav";

export const metadata = { title: "Premade sites" };

/**
 * The sites customers can start from. Each is a real site on this account —
 * edit and publish it like any other, and forks get what is live. Seed the
 * ten built-in designs with `npm run db:seed:showcase`.
 */
export default async function ShowcasesPage() {
  const session = await requirePlatformAdmin();
  const [showcases, sites] = await Promise.all([listShowcases({ all: true }), withTenant(session.tenant.id, listSites)]);
  const offered = new Set(showcases.map((s) => s.site_id));
  const fields = (s?: (typeof showcases)[number]) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="label">Title</label>
        <input name="title" required defaultValue={s?.title} className="field" />
      </div>
      <div>
        <label className="label">Short name</label>
        <input name="slug" required pattern="[a-z0-9][a-z0-9-]{0,39}" defaultValue={s?.slug} className="field font-mono text-xs" />
      </div>
      <div>
        <label className="label">For (category)</label>
        <input name="category" defaultValue={s?.category} placeholder="Bakery & café" className="field" />
      </div>
      <div>
        <label className="label">Sample business name</label>
        <input name="sample" defaultValue={s?.sample_business} placeholder="Crumb & Co." className="field" />
        <p className="help">Swapped for the customer&apos;s own name when they fork it.</p>
      </div>
      <div className="sm:col-span-2">
        <label className="label">Description</label>
        <input name="description" defaultValue={s?.description} className="field" />
      </div>
      <div>
        <label className="label">Cover picture (https)</label>
        <input name="cover" defaultValue={s?.cover_url ?? ""} className="field" />
      </div>
      <div className="flex items-end gap-4">
        <div className="w-24">
          <label className="label">Order</label>
          <input name="sort" type="number" defaultValue={s?.sort ?? 0} className="field" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="active" value="1" defaultChecked={s?.active ?? true} /> Offered
        </label>
      </div>
    </div>
  );
  return (
    <>
      <PageHeader
        eyebrow="Zuuvy Sites"
        title="Platform admin"
        description="Premade sites customers can start from. Each is a real site on your account: edit and publish it like any other, and a fork copies what is live."
      />
      <AdminTabs />
      <div className="space-y-4">
        {showcases.length === 0 && (
          <Card className="p-5 text-sm text-slate-600">
            None yet. Seed the ten built-in designs with <code className="font-mono">npm run db:seed:showcase</code>, or offer one of your own sites below.
          </Card>
        )}
        {showcases.map((s) => (
          <Card key={s.id}>
            <div className="flex flex-col gap-4 p-5 md:flex-row">
              {s.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.cover_url} alt="" className="h-28 w-44 shrink-0 rounded-lg object-cover ring-1 ring-slate-200" />
              ) : (
                <div className="grid h-28 w-44 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs text-slate-400">No cover</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-slate-900 hover:underline">{s.url.replace(/^https?:\/\//, "")}</a>
                  <Badge>{s.kind}</Badge>
                  {!s.published && <Badge tone="amber">Not published — hidden</Badge>}
                  {!s.active && <Badge>Not offered</Badge>}
                </div>
                <ActionForm action={saveShowcaseAction} className="space-y-3">
                  <input type="hidden" name="siteId" value={s.site_id} />
                  {fields(s)}
                  <div className="flex gap-2">
                    <SubmitButton size="sm" pending="Saving…">Save</SubmitButton>
                  </div>
                </ActionForm>
                <ActionForm action={removeShowcaseAction} className="mt-2">
                  <input type="hidden" name="id" value={s.id} />
                  <SubmitButton variant="ghost" size="sm" pending="Removing…" confirm={`Stop offering ${s.title}? The site stays on your account.`}>Stop offering</SubmitButton>
                </ActionForm>
              </div>
            </div>
          </Card>
        ))}
        <Card>
          <CardHeader title="Offer one of your sites" description="Any site on this account. Customers see its live version." />
          <ActionForm action={saveShowcaseAction} className="space-y-3 p-5 pt-0" resetOnOk>
            <div>
              <label className="label">Site</label>
              <select name="siteId" required className="field">
                {sites.filter((x) => !offered.has(x.id)).map((x) => (
                  <option key={x.id} value={x.id}>{x.name} ({x.subdomain})</option>
                ))}
              </select>
            </div>
            {fields()}
            <SubmitButton pending="Saving…">Offer it</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
