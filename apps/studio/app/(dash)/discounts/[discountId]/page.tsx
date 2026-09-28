import { NotFound, getDiscount, listGroups, listProducts, productCategories, withTenant } from "@zsite/platform";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { deleteDiscountAction } from "../actions";
import { DiscountForm } from "../form";

export const metadata = { title: "Discount" };

export default async function DiscountPage({ params }: { params: Promise<{ discountId: string }> }) {
  const { discountId } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenant.id, async (tx) => ({
    discount: await getDiscount(tx, discountId),
    products: await listProducts(tx),
    groups: await listGroups(tx),
    categories: (await productCategories(tx)).map((c) => c.category),
  })).catch((e) => {
    if (e instanceof NotFound || (e as Error).message === "That discount does not exist.") notFound();
    throw e;
  });
  return (
    <>
      <PageHeader eyebrow={<Link href="/discounts" className="hover:underline">Discounts</Link>} title={data.discount.name} />
      <Card>
        <DiscountForm discount={data.discount} products={data.products} groups={data.groups} categories={data.categories} />
        <ActionForm action={deleteDiscountAction} className="border-t border-slate-100 p-5">
          <input type="hidden" name="id" value={data.discount.id} />
          <SubmitButton variant="danger" pending="Deleting…" confirm="Delete this discount? Orders that used it keep their price.">
            Delete discount
          </SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
