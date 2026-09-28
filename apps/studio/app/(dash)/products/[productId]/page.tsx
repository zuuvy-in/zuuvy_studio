import { NotFound, UserError, getProduct, withTenant } from "@zsite/platform";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { ProductForm } from "../form";

export default async function EditProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const session = await requireSession();
  const product = await withTenant(session.tenant.id, (tx) => getProduct(tx, productId)).catch((e) => {
    if (e instanceof NotFound || e instanceof UserError) notFound();
    throw e;
  });
  if (product.source !== "native") notFound();
  return (
    <>
      <PageHeader eyebrow="Products" title={product.name} />
      <ProductForm product={product} />
    </>
  );
}
