import { listGroups, withTenant } from "@zsite/platform";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Tabs } from "@/components/nav";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { createGroupAction } from "./actions";
import { GroupFields } from "./fields";

export const metadata = { title: "Variant groups" };

export default async function GroupsPage() {
  const session = await requireSession();
  const groups = await withTenant(session.tenant.id, (tx) => listGroups(tx));
  return (
    <>
      <PageHeader
        title="Products"
        description="A variant group is one thing sold in several versions — a shirt in three colours, four sizes and two fits. Customers see it as one product and choose the combination."
      />
      <Tabs tabs={[{ href: "/products", label: "Products", exact: true }, { href: "/products/groups", label: `Variant groups (${groups.length})` }]} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card className="overflow-hidden">
          <CardHeader title="Groups" />
          {groups.length === 0 ? (
            <EmptyState icon="layers" title="No groups yet" body="Create one here, or tick products on the Products tab and group them." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {groups.map((g) => (
                <li key={g.id} className="flex items-center gap-3 px-5 py-3">
                  {g.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={g.images[0]} alt="" className="h-10 w-10 rounded-md object-cover ring-1 ring-slate-200" />
                  ) : (
                    <div className="h-10 w-10 rounded-md bg-slate-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <Link href={`/products/groups/${g.id}`} className="font-medium text-slate-900 hover:underline">{g.name}</Link>
                    <p className="truncate text-xs text-slate-500">{g.options.map((o) => `${o.name} (${o.values.length})`).join(" × ") || "No options yet"}</p>
                  </div>
                  <Badge tone={g.variants ? "green" : "gray"}>{g.variants} variants</Badge>
                  {!g.active && <Badge>Hidden</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="New group" description="Name it, list its options, and optionally create every combination as a product in one go." />
          <ActionForm action={createGroupAction} className="grid gap-4 p-5 sm:grid-cols-2">
            <GroupFields />
            <div>
              <label className="label" htmlFor="price">Price for each variant (₹) <span className="font-normal text-slate-400">(optional)</span></label>
              <input id="price" name="price" type="number" step="0.01" min="0" className="field" placeholder="Creates every combination" />
            </div>
            <div>
              <label className="label" htmlFor="stock">Stock for each <span className="font-normal text-slate-400">(optional)</span></label>
              <input id="stock" name="stock" type="number" step="1" min="0" className="field" />
            </div>
            <div className="sm:col-span-2">
              <SubmitButton pending="Creating…">Create group</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
