import { exportSite, isUuid } from "@zsite/platform";
import { requireSession } from "@/lib/session";

/** The whole site as a zip — and the stamp that makes deleting it possible. */
export async function GET(_: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  if (!isUuid(siteId)) return new Response("Not found", { status: 404 });
  const session = await requireSession();
  const { filename, bytes } = await exportSite(session.tenant.id, siteId);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
