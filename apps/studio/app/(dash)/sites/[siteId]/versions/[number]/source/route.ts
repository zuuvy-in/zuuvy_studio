import { exportRevision, isUuid } from "@zsite/platform";
import { requireSession } from "@/lib/session";

/** One version as editable source files (zip). */
export async function GET(_: Request, { params }: { params: Promise<{ siteId: string; number: string }> }) {
  const { siteId, number } = await params;
  if (!isUuid(siteId) || !/^\d+$/.test(number)) return new Response("Not found", { status: 404 });
  const session = await requireSession();
  const { filename, bytes } = await exportRevision(session.tenant.id, siteId, Number(number));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
