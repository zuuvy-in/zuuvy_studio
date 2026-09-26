/**
 * Renders one page of a site tree with its header and footer. The renderer
 * app uses it for live sites; the studio uses the same component for
 * previews, so what the owner reviews is exactly what customers will get.
 */
import type { SiteTree } from "@zsite/core";
import type { ReactNode } from "react";
import { blockSwitch } from "./blocks";
import type { RenderContext } from "./context";
import { fontsHref, themeStyle } from "./theme";

export const RUNTIME_VERSION = "1";

export function findPage(tree: SiteTree, path: string) {
  const clean = path === "" ? "/" : `/${path.replace(/^\/+|\/+$/g, "")}`;
  return tree.pages.find((p) => p.path === clean) ?? null;
}

export function SiteShell({ tree, ctx, children }: { tree: SiteTree; ctx: RenderContext; children: ReactNode }) {
  return (
    <div className="zs-site" style={themeStyle(tree.theme)} data-runtime={RUNTIME_VERSION}>
      {/* React hoists stylesheet links with a precedence into <head>. */}
      <link rel="stylesheet" href={fontsHref(tree.theme)} precedence="default" />
      <header className="zs-nav">
        <div className="zs-container zs-nav-inner">
          <a href={ctx.href("/")} className="zs-brand">
            {tree.nav.brand}
          </a>
          <nav className="zs-nav-links" aria-label="Main">
            {tree.nav.links.map((l, i) => (
              <a key={i} href={ctx.href(l.href)}>
                {l.label}
              </a>
            ))}
          </nav>
          {tree.nav.cta && (
            <a href={ctx.href(tree.nav.cta.href)} className="zs-btn zs-btn-primary zs-btn-sm">
              {tree.nav.cta.label}
            </a>
          )}
        </div>
      </header>
      <main>{children}</main>
      <footer className="zs-footer">
        <div className="zs-container zs-footer-inner">
          <p>{tree.footer.text}</p>
          {tree.footer.links.length > 0 && (
            <nav aria-label="Footer">
              {tree.footer.links.map((l, i) => (
                <a key={i} href={ctx.href(l.href)}>
                  {l.label}
                </a>
              ))}
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
