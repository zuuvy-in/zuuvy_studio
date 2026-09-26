import { NotFound, getVersionByNumber, isUuid, productsForTree, withTenant } from "@zsite/platform";
import { SitePage, linkRewriter } from "@zsite/runtime";
import "@zsite/runtime/styles.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { robots: { index: false } };

/**
 * A version rendered by the same runtime components the live site uses,
 * framed by the studio. Signed-in only: an unpublished version is not public.
 */
export default async function PreviewPage({ params }: { params: Promise<{ siteId: string; number: string; path?: string[] }> }) {
  const { siteId, number, path } = await params;
  if (!isUuid(siteId)) notFound();
  const session = await requireSession();
  const data = await withTenant(session.tenant.id, async (tx) => {
    const v = await getVersionByNumber(tx, siteId, Number(number));
    if (!v.tree) throw new NotFound("version");
    return { tree: v.tree, products: await productsForTree(tx, v.tree) };
  }).catch((e) => {
    if (e instanceof NotFound) notFound();
    throw e;
  });
  const base = `/preview/${siteId}/${number}`;
  return (
    <SitePage
      tree={data.tree}
      path={(path ?? []).join("/")}
      ctx={{
        mode: "preview",
        href: linkRewriter(base),
        products: data.products.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          category: p.category,
          price: p.price,
          mrp: p.mrp,
          images: p.images,
          inStock: p.in_stock,
          stock: p.stock,
          unitLabel: p.unit_label,
        })),
      }}
    />
  );
}
