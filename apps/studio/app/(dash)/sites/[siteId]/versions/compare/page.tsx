import { NotFound, compareVersions, getVersionByNumber, listVersions, withTenant } from "@zsite/platform";
import { notFound } from "next/navigation";
import { ChangeList } from "@/components/changes";
import { PreviewFrame } from "@/components/site";
import { Card, CardHeader, buttonClass } from "@/components/ui";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Compare versions" };

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { siteId } = await params;
  const q = await searchParams;
  const session = await requireSession();
  const data = await withTenant(session.tenant.id, async (tx) => {
    const versions = await listVersions(tx, siteId);
    if (!versions.length) throw new NotFound("site");
    const to = Number(q.to) || versions[0]!.number;
    const from = Number(q.from) || versions.find((v) => v.is_published)?.number || versions[versions.length - 1]!.number;
    const [a, b] = await Promise.all([getVersionByNumber(tx, siteId, from), getVersionByNumber(tx, siteId, to)]);
    const cmp = await compareVersions(tx, siteId, a.id, b.id);
    return { versions, cmp };
  }).catch((e) => {
    if (e instanceof NotFound) notFound();
    throw e;
  });
  const { versions, cmp } = data;
  const pages = (v: typeof cmp.from) => v.tree?.pages.map((p) => ({ path: p.path, title: p.title })) ?? [];

  return (
    <div className="space-y-6">
      <form className="flex flex-wrap items-end gap-3">
        {(["from", "to"] as const).map((k) => (
          <div key={k}>
            <label className="label" htmlFor={k}>{k === "from" ? "Compare" : "with"}</label>
            <select id={k} name={k} defaultValue={k === "from" ? cmp.from.number : cmp.to.number} className="field w-56">
              {versions.map((v) => (
                <option key={v.id} value={v.number}>
                  v{v.number}{v.is_published ? " (live)" : ""} — {v.summary.slice(0, 40)}
                </option>
              ))}
            </select>
          </div>
        ))}
        <button className={buttonClass("secondary")}>Compare</button>
      </form>

      <Card>
        <CardHeader title={`What changes from v${cmp.from.number} to v${cmp.to.number}`} />
        <ChangeList changes={cmp.changes} />
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        {[cmp.from, cmp.to].map((v) => (
          <div key={v.id}>
            <p className="mb-2 text-sm font-medium text-slate-700">v{v.number}{v.is_published ? " · live" : ""}</p>
            <PreviewFrame base={`/preview/${siteId}/${v.number}`} pages={pages(v)} title={`Version ${v.number}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
