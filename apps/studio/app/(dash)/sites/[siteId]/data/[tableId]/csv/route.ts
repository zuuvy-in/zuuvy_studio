import { NotFound, getSiteTable, isUuid, queryRows, rowsToCsv, withTenant } from "@zsite/platform";
import { rowQuery } from "@/lib/rows-query";
import { requireSession } from "@/lib/session";

/** The rows as a spreadsheet — those the grid's search and filters show, or all of them. */
export async function GET(request: Request, { params }: { params: Promise<{ siteId: string; tableId: string }> }) {
  const { siteId, tableId } = await params;
  if (!isUuid(siteId) || !isUuid(tableId)) return new Response("Not found", { status: 404 });
  const session = await requireSession();
  const search = Object.fromEntries(new URL(request.url).searchParams);
  try {
    const { table, rows } = await withTenant(session.tenant.id, async (tx) => {
      const table = await getSiteTable(tx, siteId, tableId);
      // Every matching row, not one page of them.
      return { table, rows: (await queryRows(tx, table, { ...rowQuery(table, search), page: 1, perPage: 10_000 })).rows };
    });
    return new Response(`﻿${rowsToCsv(table, rows)}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${table.key}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof NotFound) return new Response("Not found", { status: 404 });
    throw e;
  }
}
