/**
 * Site selection by link, for running without the platform domain.
 *
 * Normally the Host names the site (<name>.zuuvy.site). Until DNS is in place
 * the storefront answers on one shared address, so `?site=<name>` picks the
 * site: it is remembered in a cookie and the parameter is dropped, so every
 * relative link on the page keeps showing the same site. Off unless
 * ZSITE_SITE_PARAM=1 — with real subdomains the Host is the only authority.
 */
import { type NextRequest, NextResponse } from "next/server";

const SITE_COOKIE = "zs_site";

export function proxy(request: NextRequest) {
  if (process.env.ZSITE_SITE_PARAM !== "1") return NextResponse.next();
  const site = request.nextUrl.searchParams.get("site");
  if (site === null) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.searchParams.delete("site");
  // Relative, for the same reason as the studio's logout: behind the balancer the
  // request's own host is the container's, not the one the visitor typed.
  const res = new NextResponse(null, { status: 303, headers: { Location: `${url.pathname}${url.search}` } });
  if (/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(site)) {
    res.cookies.set(SITE_COOKIE, site, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/|api/health).*)"],
};
