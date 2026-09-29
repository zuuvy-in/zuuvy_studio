import type { SiteData } from "@zsite/core";
import type { ReactNode } from "react";

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
  /** The store takes orders beyond its stock, so out of stock still sells. */
  backorders?: boolean;
  /** The variant group this product belongs to: a grid shows the group as one card. */
  group?: { id: string; name: string; images: string[] };
};

/** A store's live state for the header: the cart and who is signed in. */
export type ShopContext = {
  cartCount: number;
  /** First name of the signed-in customer; null when nobody is. */
  signedIn: string | null;
  /** The cart drawer's contents, when the store uses a drawer. */
  drawer?: ReactNode;
  /** Open the drawer on this page (just after something was added). */
  drawerOpen?: boolean;
  /** Where closing the drawer goes: this page without the open flag. */
  closeHref?: string;
};

export type RenderContext = {
  mode: "live" | "preview";
  products: ProductView[];
  /** The version's data collections, for `collection` sections. */
  data?: SiteData;
  /** Rewrite a tree link for where the site is being shown (live, or inside the studio's preview). */
  href: (href: string) => string;
  /** Where a product card goes; absent = cards are not links. */
  productHref?: (productId: string) => string;
  /** Where a variant group's card goes. */
  groupHref?: (groupId: string) => string;
  /** A store: cart and account in the header. Absent on sites that do not sell. */
  shop?: ShopContext;
  /** A quick "add to cart" control under a product card, when the store offers one. */
  cardAction?: (product: ProductView) => ReactNode;
  /** Live sites: where forms post, and the outcome of the last submission. Absent in previews. */
  forms?: {
    action: string;
    page: string;
    /** When the page was drawn (ms), sent back to tell people from instant bots. */
    renderedAt: number;
    status?: { section: string; ok?: string; error?: string };
  };
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
