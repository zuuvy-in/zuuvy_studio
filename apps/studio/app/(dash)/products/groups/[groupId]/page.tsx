import { NotFound, getGroup, listProducts, withTenant } from "@zsite/platform";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { addProductsAction, deleteGroupAction, generateAction, saveVariantsAction, updateGroupAction } from "../actions";
import { GroupFields } from "../fields";

export const metadata = { title: "Variant group" };

export default async function GroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const session = await requireSession();
  const { group, others } = await withTenant(session.tenant.id, async (tx) => ({
    group: await getGroup(tx, groupId),
    others: (await listProducts(tx, { includeHidden: true })).filter((p) => p.group_id === null),
  })).catch((e) => {
    if (e instanceof NotFound || (e as Error).message === "That group does not exist.") notFound();
    throw e;
  });
  const combos = group.options.reduce((n, o) => n * o.values.length, group.options.length ? 1 : 0);
  const complete = group.variants.filter((v) => group.options.every((o) => v.options[o.name])).length;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/products/groups" className="hover:underline">Variant groups</Link>}
        title={group.name}
        description={`${group.variants.length} variants of ${combos} possible combinations${group.variants.length > complete ? ` · ${group.variants.length - complete} still need their options set` : ""}.`}
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Variants" description="Which combination each product is. Customers pick the options and reach exactly one of these." />
          {group.variants.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-slate-600">No variants yet. Create every combination below, or add products you already have.</p>
          ) : (
            <ActionForm action={saveVariantsAction} className="overflow-x-auto">
              <input type="hidden" name="id" value={group.id} />
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Product</th>
                    {group.options.map((o) => (
                      <th key={o.name} className="px-3 py-3 font-medium">{o.name}</th>
                    ))}
                    <th className="px-3 py-3 font-medium">Price (₹)</th>
                    <th className="px-3 py-3 font-medium">Stock</th>
                    <th className="px-5 py-3 font-medium">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {group.variants.map((v) => (
                    <tr key={v.id}>
                      <td className="px-5 py-2">
                        <div className="flex items-center gap-2">
                          {v.images[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.images[0]} alt="" className="h-8 w-8 rounded object-cover ring-1 ring-slate-200" />
                          ) : (
                            <div className="h-8 w-8 rounded bg-slate-100" />
                          )}
                          {v.source === "native" ? (
                            <Link href={`/products/${v.id}`} className="font-medium text-slate-900 hover:underline">{v.name}</Link>
                          ) : (
                            <span className="font-medium text-slate-900">{v.name} <Badge tone="brand">Zuuvy</Badge></span>
                          )}
                        </div>
                      </td>
                      {group.options.map((o) => (
                        <td key={o.name} className="px-3 py-2">
                          <select name={`opt:${v.id}:${o.name}`} defaultValue={v.options[o.name] ?? ""} className="field min-w-32 py-1.5">
                            <option value="">—</option>
                            {o.values.map((val) => (
                              <option key={val}>{val}</option>
                            ))}
                          </select>
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        {v.source === "native" ? (
                          <input name={`price:${v.id}`} type="number" step="0.01" min="0" defaultValue={v.price ?? ""} className="field max-w-28 py-1.5" />
                        ) : (
                          <span className="text-slate-500">{v.price ?? "—"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {v.source === "native" ? (
                          <input name={`stock:${v.id}`} type="number" step="1" min="0" defaultValue={v.stock ?? ""} placeholder="—" className="field max-w-24 py-1.5" />
                        ) : (
                          <span className="text-slate-500">{v.stock ?? "—"}</span>
                        )}
                      </td>
                      <td className="px-5 py-2">
                        <input type="checkbox" name="remove" value={v.id} aria-label={`Take ${v.name} out of the group`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="p-5">
                <SubmitButton pending="Saving…">Save variants</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Create the missing combinations" description="Adds a product for every combination the group does not have yet. Existing variants are left alone." />
            <ActionForm action={generateAction} className="grid gap-4 p-5 sm:grid-cols-3">
              <input type="hidden" name="id" value={group.id} />
              <div>
                <label className="label" htmlFor="gprice">Price (₹)</label>
                <input id="gprice" name="price" type="number" step="0.01" min="0" required className="field" />
              </div>
              <div>
                <label className="label" htmlFor="gmrp">MRP (₹)</label>
                <input id="gmrp" name="mrp" type="number" step="0.01" min="0" className="field" />
              </div>
              <div>
                <label className="label" htmlFor="gstock">Stock each</label>
                <input id="gstock" name="stock" type="number" step="1" min="0" className="field" />
              </div>
              <div className="sm:col-span-3">
                <SubmitButton pending="Creating…" variant="secondary">Create {Math.max(0, combos - group.variants.length)} variants</SubmitButton>
              </div>
            </ActionForm>
          </Card>
          <Card>
            <CardHeader title="Add products you already have" description="Then set which combination each one is in the table above." />
            <ActionForm action={addProductsAction} className="space-y-3 p-5">
              <input type="hidden" name="id" value={group.id} />
              <select name="ids" multiple size={6} className="field">
                {others.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <p className="help">Hold Ctrl (or ⌘) to choose several.</p>
              <SubmitButton pending="Adding…" variant="secondary">Add to group</SubmitButton>
            </ActionForm>
          </Card>
        </div>

        <Card>
          <CardHeader title="Group details" />
          <ActionForm action={updateGroupAction} className="grid gap-4 p-5 sm:grid-cols-2">
            <input type="hidden" name="id" value={group.id} />
            <GroupFields group={group} />
            <label className="flex items-center gap-2 self-center text-sm text-slate-700">
              <input type="checkbox" name="active" value="1" defaultChecked={group.active} /> Shown in stores
              <input type="hidden" name="active" value="0" />
            </label>
            <div className="sm:col-span-2">
              <SubmitButton pending="Saving…">Save group</SubmitButton>
            </div>
          </ActionForm>
          <ActionForm action={deleteGroupAction} className="border-t border-slate-100 p-5">
            <input type="hidden" name="id" value={group.id} />
            <SubmitButton variant="danger" pending="Deleting…" confirm={`Delete the group "${group.name}"? Its products stay, ungrouped.`}>
              Delete group
            </SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
