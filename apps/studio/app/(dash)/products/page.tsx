import { listProducts, managesProducts, withTenant } from "@zsite/platform";
import Link from "next/link";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { ago, inr } from "@/lib/format";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; hidden?: string }> }) {
  const q = await searchParams;
  const session = await requireSession();
  const { products, manages } = await withTenant(session.tenant.id, async (tx) => ({
    products: await listProducts(tx, { q: q.q, includeHidden: q.hidden === "1" }),
    manages: await managesProducts(tx),
  }));
  return (
    <>
      <PageHeader
        title="Products"
        description="What your stores sell. Products you add here are managed here; products from a data source such as Zuuvy are managed there — prices, stock and listing all come from it."
        actions={manages ? <ButtonLink href="/products/new">Add product</ButtonLink> : undefined}
      />
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
      <Card className="overflow-x-auto">
        {products.length === 0 ? (
          <EmptyState icon="box" title="No products" body={manages ? "Add your first product, or connect a data source." : "Connect Zuuvy and mark products for online sale there."} action={manages ? <ButtonLink href="/products/new">Add product</ButtonLink> : <ButtonLink href="/integrations/zuuvy">Connect Zuuvy</ButtonLink>} />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Product</th>
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
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      {p.images[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.images[0]} alt="" className="h-10 w-10 rounded-md object-cover ring-1 ring-slate-200" />
                      ) : (
                        <div className="h-10 w-10 rounded-md bg-slate-100" />
                      )}
                      <div className="min-w-0">
                        {p.source === "native" ? (
                          <Link href={`/products/${p.id}`} className="truncate font-medium text-slate-900 hover:underline">{p.name}</Link>
                        ) : (
                          <p className="truncate font-medium text-slate-900">{p.name}</p>
                        )}
                        <p className="text-xs text-slate-500">{p.source === "native" ? `updated ${ago(p.updated_at)}` : `synced ${ago(p.synced_at)}`}</p>
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
    </>
  );
}
