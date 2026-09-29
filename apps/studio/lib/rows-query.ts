import type { RowQuery, SiteTable } from "@zsite/platform";

export type Search = Record<string, string | string[] | undefined>;

/** The Data grid's state lives in the URL: q, sort, dir, page and f_<column>. */
export function rowQuery(table: SiteTable, s: Search): RowQuery {
  const one = (k: string) => (typeof s[k] === "string" ? (s[k] as string) : "");
  const filters: Record<string, string> = {};
  for (const c of table.columns) if (one(`f_${c.key}`)) filters[c.key] = one(`f_${c.key}`).slice(0, 100);
  return {
    q: one("q").slice(0, 100) || undefined,
    filters,
    sort: one("sort") || undefined,
    dir: one("dir") === "asc" ? "asc" : "desc",
    page: Number(one("page")) || 1,
    perPage: 50,
  };
}

/** The same state, changed, as a query string. */
export function withQuery(s: Search, change: Record<string, string | number | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(s)) if (typeof v === "string" && v) q.set(k, v);
  for (const [k, v] of Object.entries(change)) {
    if (v === null || v === "") q.delete(k);
    else q.set(k, String(v));
  }
  const out = q.toString();
  return out ? `?${out}` : "";
}
