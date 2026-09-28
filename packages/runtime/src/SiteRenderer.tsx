/**
 * Renders one page of a site tree with its header and footer. The renderer
 * app uses it for live sites; the studio uses the same component for
 * previews, so what the owner reviews is exactly what customers will get.
 */
import { type Commerce, DEFAULT_COMMERCE, type SiteTree } from "@zsite/core";
import type { ReactNode } from "react";
import { blockSwitch } from "./blocks";
import type { RenderContext } from "./context";
import { fontsHref, themeStyle } from "./theme";

export const RUNTIME_VERSION = "1";

export function findPage(tree: SiteTree, path: string) {
  const clean = path === "" ? "/" : `/${path.replace(/^\/+|\/+$/g, "")}`;
  return tree.pages.find((p) => p.path === clean) ?? null;
}

const ICONS: Record<Commerce["cart"]["icon"] | "user", ReactNode> = {
  bag: <path d="M6 7h12l-1 13H7L6 7Zm3 0a3 3 0 0 1 6 0" />,
  cart: <path d="M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6.2M10 20h.01M17 20h.01" />,
  basket: <path d="M4 10h16l-1.6 9H5.6L4 10Zm3 0 3-6m7 6-3-6M9 14v2m6-2v2" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" />,
};

export function CommerceIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/** The store's commerce settings, defaults filled in. */
export function commerceOf(tree: SiteTree): Commerce {
  return tree.commerce ?? DEFAULT_COMMERCE;
}

function CartLink({ c, ctx, floating }: { c: Commerce; ctx: RenderContext; floating?: boolean }) {
  const count = ctx.shop?.cartCount ?? 0;
  const href = c.cart.style === "drawer" && ctx.shop?.drawer ? "#cart" : ctx.href("/cart");
  return (
    <a href={href} className={floating ? "zs-cart-float" : "zs-cart-link"} aria-label={`${c.cart.label ?? "Cart"}${count ? `, ${count} items` : ""}`}>
      <CommerceIcon name={c.cart.icon} />
      {c.cart.label && !floating && <span>{c.cart.label}</span>}
      {count > 0 && <span className="zs-cart-count">{count}</span>}
    </a>
  );
}

function AccountLink({ c, ctx }: { c: Commerce; ctx: RenderContext }) {
  return (
    <a href={ctx.href("/account")} className="zs-account-link">
      <CommerceIcon name="user" />
      <span>{ctx.shop?.signedIn ? `Hi, ${ctx.shop.signedIn}` : c.account.label}</span>
    </a>
  );
}

export function SiteShell({ tree, ctx, children }: { tree: SiteTree; ctx: RenderContext; children: ReactNode }) {
  const shop = ctx.shop ? commerceOf(tree) : null;
  return (
    <div className="zs-site" style={themeStyle(tree.theme)} data-runtime={RUNTIME_VERSION} data-motion={tree.theme.motion ?? "subtle"}>
      {/* React hoists stylesheet links with a precedence into <head>. */}
      <link rel="stylesheet" href={fontsHref(tree.theme)} precedence="default" />
      <header className="zs-nav">
        <div className="zs-container zs-nav-inner">
          <a href={ctx.href("/")} className="zs-brand">
            {tree.nav.logo && <img src={tree.nav.logo} alt="" className="zs-brand-logo" />}
            {tree.nav.brand}
          </a>
          <nav className="zs-nav-links" aria-label="Main">
            {tree.nav.links.map((l, i) => (
              <a key={i} href={ctx.href(l.href)}>
                {l.label}
              </a>
            ))}
          </nav>
          {(tree.nav.cta || shop) && (
            <div className="zs-nav-actions">
              {shop?.account.show && shop.account.placement === "nav" && <AccountLink c={shop} ctx={ctx} />}
              {shop && shop.cart.placement === "nav" && <CartLink c={shop} ctx={ctx} />}
              {tree.nav.cta && (
                <a href={ctx.href(tree.nav.cta.href)} className="zs-btn zs-btn-primary zs-btn-sm">
                  {tree.nav.cta.label}
                </a>
              )}
            </div>
          )}
        </div>
      </header>
      <main>{children}</main>
      {shop && shop.cart.placement === "floating" && <CartLink c={shop} ctx={ctx} floating />}
      {shop && shop.cart.style === "drawer" && ctx.shop?.drawer && (
        <div id="cart" className="zs-drawer" role="dialog" aria-label="Your cart" data-open={ctx.shop.drawerOpen ? "" : undefined}>
          <a href={ctx.shop.closeHref ?? "#"} className="zs-drawer-backdrop" aria-label="Close cart" />
          <div className="zs-drawer-panel">
            <div className="zs-drawer-head">
              <strong>{shop.cart.label ?? "Your cart"}</strong>
              <a href={ctx.shop.closeHref ?? "#"} aria-label="Close cart" className="zs-drawer-close">×</a>
            </div>
            {ctx.shop.drawer}
          </div>
        </div>
      )}
      <footer className="zs-footer">
        <div className="zs-container zs-footer-inner">
          <p>{tree.footer.text}</p>
          {(tree.footer.links.length > 0 || (shop?.account.show && shop.account.placement === "footer")) && (
            <nav aria-label="Footer">
              {tree.footer.links.map((l, i) => (
                <a key={i} href={ctx.href(l.href)}>
                  {l.label}
                </a>
              ))}
              {shop?.account.show && shop.account.placement === "footer" && (
                <a href={ctx.href("/account")}>{ctx.shop?.signedIn ? `${shop.account.label} (${ctx.shop.signedIn})` : shop.account.label}</a>
              )}
            </nav>
          )}
        </div>
      </footer>
    </div>
  );
}

export function SitePage({ tree, path, ctx }: { tree: SiteTree; path: string; ctx: RenderContext }) {
  const page = findPage(tree, path);
  return (
    <SiteShell tree={tree} ctx={ctx}>
      {page ? (
        page.sections.map((s) => blockSwitch(s, ctx))
      ) : (
        <section className="zs-section">
          <div className="zs-container zs-narrow zs-center">
            <h1>Page not found</h1>
            <p className="zs-lede">That page does not exist.</p>
            <a href={ctx.href("/")} className="zs-btn zs-btn-primary">
              Go to the home page
            </a>
          </div>
        </section>
      )}
    </SiteShell>
  );
}
