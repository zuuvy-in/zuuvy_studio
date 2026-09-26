/** What a block needs to know beyond its own props. */
export type ProductView = {
  id: string;
  name: string;
  description: string;
  category: string | null;
  price: number | null;
  mrp: number | null;
  images: string[];
  inStock: boolean;
  stock: number | null;
  unitLabel: string | null;
};

export type RenderContext = {
  mode: "live" | "preview";
  products: ProductView[];
  /** Rewrite a tree link for where the site is being shown (live, or inside the studio's preview). */
  href: (href: string) => string;
  /** Where a product card goes; absent = cards are not links. */
  productHref?: (productId: string) => string;
};

/** Internal links are prefixed with `base`; everything else passes through. */
export function linkRewriter(base: string): (href: string) => string {
  const b = base.replace(/\/+$/, "");
  return (href) => {
    if (!href.startsWith("/")) return href;
    if (!b) return href;
    return href === "/" ? `${b}/` : `${b}${href}`;
  };
}
