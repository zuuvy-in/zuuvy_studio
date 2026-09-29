"use client";

import { createContext, useContext } from "react";

/**
 * The site a page belongs to, for the pages that exist both business-wide and
 * under one site (products, orders, discounts…). Every ActionForm inside posts
 * it as `_scope`, so an action knows where it was used and where to return.
 */
const ScopeContext = createContext<string | null>(null);

export function ScopeProvider({ siteId, children }: { siteId: string; children: React.ReactNode }) {
  return <ScopeContext.Provider value={siteId}>{children}</ScopeContext.Provider>;
}

export function ScopeField() {
  const siteId = useContext(ScopeContext);
  return siteId ? <input type="hidden" name="_scope" value={siteId} /> : null;
}
