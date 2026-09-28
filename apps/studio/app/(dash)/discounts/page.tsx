import { listDiscounts, listGroups, listProducts, productCategories, withTenant } from "@zsite/platform";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { DiscountForm } from "./form";

export const metadata = { title: "Discounts" };

const describe = (d: { kind: string; value: number; scope: string; scope_ids: string[]; min_subtotal: number | null }) =>
  `${d.kind === "percent" ? `${d.value}% off` : `₹${d.value} off`} ${d.scope === "all" ? "the cart" : `${d.scope_ids.length} ${d.scope}`}${
    d.min_subtotal ? ` over ₹${d.min_subtotal}` : ""
  }`;

export default async function DiscountsPage() {
  const session = await requireSession();
  const data = await withTenant(session.tenant.id, async (tx) => ({
    discounts: await listDiscounts(tx),
    products: await listProducts(tx),
    groups: await listGroups(tx),
    categories: (await productCategories(tx)).map((c) => c.category),
  }));
  const now = Date.now();
  return (
    <>
      <PageHeader
        title="Discounts"
        description="Offers for your stores. Without a code a discount applies by itself whenever its rules hold; with a code, when the customer enters it. The best offer for the customer wins unless an offer is set to combine."
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <Card className="overflow-hidden">
          <CardHeader title="Your discounts" />
          {data.discounts.length === 0 ? (
            <EmptyState icon="tag" title="No discounts yet" body="Create one with the form." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.discounts.map((d) => {
                const ended = d.ends_at && new Date(d.ends_at).getTime() < now;
                const out = d.usage_limit !== null && d.used_count >= d.usage_limit;
                return (
                  <li key={d.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/discounts/${d.id}`} className="font-medium text-slate-900 hover:underline">{d.name}</Link>
                      {!d.active ? <Badge>Paused</Badge> : ended ? <Badge tone="amber">Ended</Badge> : out ? <Badge tone="amber">Used up</Badge> : <Badge tone="green">Running</Badge>}
                    </div>
                    <p className="text-xs text-slate-500">
                      {d.code ? <code className="rounded bg-slate-100 px-1 font-mono">{d.code}</code> : "Automatic"} · {describe(d)} · used {d.used_count}
                      {d.usage_limit !== null ? `/${d.usage_limit}` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="New discount" />
          <DiscountForm products={data.products} groups={data.groups} categories={data.categories} />
        </Card>
      </div>
    </>
  );
}
