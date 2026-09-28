import { storefrontGroup } from "@zsite/platform";
import { SiteShell, commerceOf } from "@zsite/runtime";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VariantPicker } from "@/app/p/gallery";
import { chromeContext, isStore } from "@/lib/shop";
import { currentSite } from "@/lib/site";

type Props = { params: Promise<{ groupId: string }>; searchParams: Promise<{ v?: string; cart?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const current = await currentSite();
  if (!current) return {};
  const found = await storefrontGroup(current.resolved, (await params).groupId);
  return found ? { title: `${found.group.name} · ${current.site.tree.meta.title}`, description: found.group.description.slice(0, 160) } : {};
}

/** A group of variants: one page to choose Colour × Size × Fit, with the group's own photos after the variant's. */
export default async function GroupPage({ params, searchParams }: Props) {
  const current = await currentSite();
  if (!current || !isStore(current)) notFound();
  const { groupId } = await params;
  const found = await storefrontGroup(current.resolved, groupId);
  if (!found) notFound();
  const { group, variants } = found;
  const query = await searchParams;
  const ctx = await chromeContext(current, { path: `/g/${group.id}`, cart: query.cart });
  // Only the values some variant actually has, in the group's order.
  const options = group.options
    .map((o) => ({ name: o.name, values: o.values.filter((v) => variants.some((p) => p.options[o.name] === v)) }))
    .filter((o) => o.values.length);
  return (
    <SiteShell tree={current.site.tree} ctx={ctx}>
      <div className="zs-container zs-page">
        <p>
          <a href="/#shop" className="zs-muted">← Back to the shop</a>
        </p>
        {group.category && <p className="zs-product-cat">{group.category}</p>}
        <VariantPicker
          name={group.name}
          options={options}
          variants={variants.map((p) => ({
            id: p.id,
            options: p.options,
            price: p.price,
            mrp: p.mrp,
            inStock: p.in_stock,
            backorders: Boolean(p.backorders),
            stock: p.stock,
            images: p.images,
          }))}
          groupImages={group.images}
          initial={query.v ?? null}
          buy={commerceOf(current.site.tree).buy}
          back={`/g/${group.id}`}
        />
        {group.description && (
          <div className="zs-prose" style={{ marginTop: 32 }}>
            {group.description.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        )}
      </div>
    </SiteShell>
  );
}
