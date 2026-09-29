import { NotFound, getSiteTable, isUuid, listRows, rowsToCsv, withTenant } from "@zsite/platform";
import { requireSession } from "@/lib/session";

/** Every answer as a spreadsheet. */
export async function GET(_: Request, { params }: { params: Promise<{ siteId: string; tableId: string }> }) {
  const { siteId, tableId } = await params;
  if (!isUuid(siteId) || !isUuid(tableId)) return new Response("Not found", { status: 404 });
  const session = await requireSession();
  try {
    const { table, rows } = await withTenant(session.tenant.id, async (tx) => {
      const table = await getSiteTable(tx, siteId, tableId);
      return { table, rows: await listRows(tx, table.id, { limit: 1000 }) };
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
