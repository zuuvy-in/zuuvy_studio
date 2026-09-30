import { listGroups, listProducts, managesProducts, variantLabel, withTenant } from "@zsite/platform";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Tabs } from "@/components/nav";
import { groupSelectedAction } from "./actions";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { ago, inr } from "@/lib/format";
import { pageScope } from "@/lib/scope";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Products" };

export default async function ProductsPage({ params, searchParams }: { params: Promise<{ siteId?: string }>; searchParams: Promise<{ q?: string; hidden?: string }> }) {
  const q = await searchParams;
  const session = await requireSession();
  const { siteId, base } = await pageScope(params);
  const { products, manages, groups } = await withTenant(session.tenant.id, async (tx) => ({
    products: await listProducts(tx, { q: q.q, includeHidden: q.hidden === "1", siteId }),
    manages: await managesProducts(tx),
    groups: await listGroups(tx, siteId),
  }));
  const byId = new Map(groups.map((g) => [g.id, g]));
  return (
    <>
      <PageHeader
        title="Products"
        description="What your stores sell. Products you add here are managed here; products from a data source such as Zuuvy are managed there — prices, stock and listing all come from it."
        actions={manages ? <ButtonLink href={`${base}/products/new`}>Add product</ButtonLink> : undefined}
      />
      <Tabs tabs={[{ href: `${base}/products`, label: "Products", exact: true }, { href: `${base}/products/groups`, label: `Variant groups (${groups.length})` }]} />
      {!manages && (
        <p className="mb-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
          To add products here, set a store's inventory to <strong>Zuuvy Studio</strong> or <strong>None</strong> in its site settings.
        </p>
      )}
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q.q} placeholder="Search name or category" className="field max-w-xs" />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="hidden" value="1" defaultChecked={q.hidden === "1"} /> Show hidden
        </label>
        <button className="rounded-lg bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-50">Filter</button>
      </form>
      <ActionForm action={groupSelectedAction}>
      <Card className="overflow-x-auto">
        {products.length === 0 ? (
          <EmptyState icon="box" title="No products" body={manages ? "Add your first product, or connect a data source." : "Connect Zuuvy and mark products for online sale there."} action={manages ? <ButtonLink href={`${base}/products/new`}>Add product</ButtonLink> : <ButtonLink href={`${base}/integrations/zuuvy`}>Connect Zuuvy</ButtonLink>} />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
              <tr>
                <th className="w-8 py-3 pl-5"><span className="sr-only">Select</span></th>
                <th className="px-3 py-3 font-medium">Product</th>
                <th className="px-3 py-3 font-medium">Category</th>
                <th className="px-3 py-3 text-right font-medium">Price</th>
                <th className="px-3 py-3 text-right font-medium">Stock</th>
                <th className="px-3 py-3 font-medium">Source</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p) => (
                <tr key={p.id} className={p.active ? "" : "opacity-60"}>
                  <td className="py-3 pl-5">
                    <input type="checkbox" name="ids" value={p.id} aria-label={`Select ${p.name}`} />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      {p.images[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.images[0]} alt="" className="h-10 w-10 rounded-md object-cover ring-1 ring-slate-200" />
                      ) : (
                        <div className="h-10 w-10 rounded-md bg-slate-100" />
                      )}
                      <div className="min-w-0">
                        {p.source === "native" ? (
                          <Link href={`${base}/products/${p.id}`} className="truncate font-medium text-slate-900 hover:underline">{p.name}</Link>
                        ) : (
                          <p className="truncate font-medium text-slate-900">{p.name}</p>
                        )}
                        <p className="text-xs text-slate-500">
                          {p.group_id ? (
                            <Link href={`${base}/products/groups/${p.group_id}`} className="text-brand-700 hover:underline">
                              {byId.get(p.group_id)?.name}
                              {/* In the group's option order: jsonb does not keep the keys' order. */}
                              {Object.keys(p.options).length > 0 && ` · ${variantLabel(byId.get(p.group_id)?.options ?? [], p.options)}`}
                            </Link>
                          ) : p.source === "native" ? (
                            `updated ${ago(p.updated_at)}`
                          ) : (
                            `synced ${ago(p.synced_at)}`
                          )}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{p.category ?? "—"}</td>
                  <td className="px-3 py-3 text-right font-medium">
                    {inr(p.price)}
                    {p.mrp !== null && p.price !== null && p.mrp > p.price && <span className="ml-1 text-xs font-normal text-slate-400 line-through">{inr(p.mrp)}</span>}
                  </td>
                  <td className="px-3 py-3 text-right">{p.stock === null ? "—" : p.stock}</td>
                  <td className="px-3 py-3"><Badge tone={p.source === "zuuvy" ? "brand" : "gray"}>{p.source === "zuuvy" ? "Zuuvy" : "Studio"}</Badge></td>
                  <td className="px-5 py-3">
                    {!p.active ? <Badge>Hidden</Badge> : p.in_stock ? <Badge tone="green">On sale</Badge> : <Badge tone="amber">Out of stock</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {products.length > 0 && (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200">
          <div>
            <p className="text-sm font-medium text-slate-900">Group the ticked products as variants</p>
            <p className="text-xs text-slate-500">For one thing sold in several versions — colours, sizes, fits. Then set which version each one is.</p>
          </div>
          <select name="groupId" className="field w-auto" defaultValue="">
            <option value="">New group…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <input name="groupName" placeholder="New group's name, e.g. Linen shirt" className="field w-64" />
          <SubmitButton pending="Grouping…">Group</SubmitButton>
        </div>
      )}
      </ActionForm>
    </>
  );
}
