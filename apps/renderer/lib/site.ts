import "server-only";
import { type ResolvedSite, type StorefrontSite, config, loadPublished, resolveHost, storefrontData } from "@zsite/platform";
import type { ProductView, RenderContext } from "@zsite/runtime";
import { linkRewriter } from "@zsite/runtime";
import { cookies, headers } from "next/headers";
import { cache } from "react";

export type Current = { resolved: ResolvedSite; site: StorefrontSite };

/** The site this request's Host names, resolved once per request. */
export const currentSite = cache(async (): Promise<Current | null> => {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  let resolved = await resolveHost(host);
  // Running without the platform domain: the site chosen by ?site= (proxy.ts).
  if (!resolved && process.env.ZSITE_SITE_PARAM === "1") {
    const chosen = (await cookies()).get("zs_site")?.value;
    if (chosen) resolved = await resolveHost(`${chosen}.${config.platformDomain()}`);
  }
  if (!resolved) return null;
  const site = await loadPublished(resolved);
  return site ? { resolved, site } : null;
});

export function toView(p: {
  id: string;
  name: string;
  description: string;
  category: string | null;
  price: number | null;
  mrp: number | null;
  images: string[];
  in_stock: boolean;
  stock: number | null;
  unit_label: string | null;
  backorders?: boolean;
}): ProductView {
  return {
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
    backorders: p.backorders ?? false,
  };
}

export async function liveContext(current: Current): Promise<RenderContext> {
  const products = await storefrontData(current.resolved, current.site.tree);
  return {
    mode: "live",
    href: linkRewriter(""),
    products: products.map(toView),
    data: current.site.data,
    productHref: (id) => `/p/${id}`,
  };
}
