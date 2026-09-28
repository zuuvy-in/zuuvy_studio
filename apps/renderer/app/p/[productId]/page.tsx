import { storefrontProduct } from "@zsite/platform";
import { SiteShell, commerceOf } from "@zsite/runtime";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentSite } from "@/lib/site";
import { AddToCart } from "@/app/cart/controls";
import { chromeContext, isStore } from "@/lib/shop";
import { Gallery } from "../gallery";

type Props = { params: Promise<{ productId: string }>; searchParams: Promise<{ cart?: string }> };

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const current = await currentSite();
  if (!current) return {};
  const product = await storefrontProduct(current.resolved, (await params).productId);
  return product ? { title: `${product.name} · ${current.site.tree.meta.title}`, description: product.description.slice(0, 160) } : {};
}

export default async function ProductPage({ params, searchParams }: Props) {
  const current = await currentSite();
  if (!current) notFound();
  const product = await storefrontProduct(current.resolved, (await params).productId);
  if (!product) notFound();
  // A variant is chosen on its group's page, where its siblings are.
  if (product.group_id) redirect(`/g/${product.group_id}?v=${product.id}`);
  const ctx = await chromeContext(current, { path: `/p/${product.id}`, cart: (await searchParams).cart });
  const c = commerceOf(current.site.tree);
  return (
    <SiteShell tree={current.site.tree} ctx={ctx}>
      <div className="zs-container zs-page">
        <p><a href="/#shop" className="zs-muted">← Back to the shop</a></p>
        <div className="zs-product-page">
          <Gallery images={product.images} name={product.name} />
          <div>
            {product.category && <p className="zs-product-cat">{product.category}</p>}
            <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)" }}>{product.name}</h1>
            {product.price !== null && (
              <p className="zs-price" style={{ fontSize: "1.5rem" }}>
                {inr(product.price)}
                {product.mrp !== null && product.mrp > product.price && <s>{inr(product.mrp)}</s>}
                {product.unit_label && <span className="zs-muted" style={{ fontSize: "0.9rem", fontWeight: 400 }}>per {product.unit_label}</span>}
              </p>
            )}
            {product.description && <p className="zs-lede" style={{ marginTop: 16 }}>{product.description}</p>}
            <p className={product.in_stock || product.backorders ? "" : "zs-alert"} style={{ fontWeight: 600 }}>
              {!product.in_stock
                ? product.backorders
                  ? "Made to order — the shop confirms when it can deliver"
                  : "Out of stock"
                : product.stock !== null && product.stock <= 10 && !product.backorders
                  ? `Only ${product.stock} left`
                  : "In stock"}
            </p>
            <div style={{ marginTop: 20 }}>
              {isStore(current) ? (
                <AddToCart
                  productId={product.id}
                  buy={c.buy}
                  back={`/p/${product.id}`}
                  max={product.backorders ? null : product.stock}
                  disabled={!product.in_stock && !product.backorders}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
