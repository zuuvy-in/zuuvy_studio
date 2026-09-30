import { PageHeader } from "@/components/ui";
import { pageScope } from "@/lib/scope";
import { requireSession } from "@/lib/session";
import { ProductForm } from "../form";

export const metadata = { title: "Add product" };

export default async function NewProductPage({ params }: { params: Promise<{ siteId?: string }> }) {
  await requireSession();
  const { siteId, base } = await pageScope(params);
  return (
    <>
      <PageHeader eyebrow="Products" title="Add a product" description="Sold by stores whose inventory is managed in Zuuvy Studio (or not tracked)." />
      <ProductForm />
    </>
  );
}
