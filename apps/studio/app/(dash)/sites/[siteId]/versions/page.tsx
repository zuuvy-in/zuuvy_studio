import { getSite, listPublications, listVersions, withTenant } from "@zsite/platform";
import Link from "next/link";
import { SourceBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Composer } from "@/components/site";
import { Badge, ButtonLink, Card, CardHeader, Icon } from "@/components/ui";
import { ago, dateTime } from "@/lib/format";
import { aiStatus } from "@/lib/ai";
import { requireSession } from "@/lib/session";
import { generateAction, publishAction } from "../../actions";

export const metadata = { title: "Versions" };

export default async function VersionsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const session = await requireSession();
  const ai = aiStatus();
  const { site, versions, publications } = await withTenant(session.tenant.id, async (tx) => ({
    site: await getSite(tx, siteId),
    versions: await listVersions(tx, siteId),
    publications: await listPublications(tx, siteId),
  }));
  const latest = versions[0]!;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-6">
        <Composer action={generateAction} siteId={site.id} baseNumber={latest.number} aiReady={ai.ready} setupHint={ai.hint} />

        <Card>
          <CardHeader title="All versions" description="Every change is kept. Open one to preview it, see what changed, publish it or bring it back." />
          <ol className="divide-y divide-slate-100">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
                <Link href={`/sites/${site.id}/versions/${v.number}`} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 font-mono text-sm font-semibold text-slate-700 hover:bg-brand-50 hover:text-brand-700">
                  v{v.number}
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/sites/${site.id}/versions/${v.number}`} className="font-medium text-slate-900 hover:underline">{v.summary || "Untitled change"}</Link>
                    <SourceBadge source={v.source} />
                    {v.is_published && <Badge tone="green"><Icon name="check" className="h-3 w-3" /> Live</Badge>}
                    {v.mode === "code" && <Badge tone="violet">Code</Badge>}
                  </div>
                  {v.prompt && <p className="mt-1 line-clamp-2 text-sm text-slate-600">“{v.prompt}”</p>}
                  <p className="mt-1 text-xs text-slate-500">
                    {v.created_by_name ?? "System"} · <time title={dateTime(v.created_at)}>{ago(v.created_at)}</time>
                    {v.parent_number && <> · from v{v.parent_number}</>}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <ButtonLink href={`/sites/${site.id}/versions/${v.number}`} variant="secondary" size="sm">Preview</ButtonLink>
                  {!v.is_published && (
                    <ActionForm action={publishAction}>
                      <input type="hidden" name="siteId" value={site.id} />
                      <input type="hidden" name="number" value={v.number} />
                      <SubmitButton size="sm" pending="Publishing…" confirm={`Publish version ${v.number} to ${site.url}?`}>Publish</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <aside className="space-y-6">
        <Card>
          <CardHeader title="Publish history" description="Rolling back is publishing an earlier version." />
          <ol className="space-y-0 px-5 py-3 text-sm">
            {publications.map((p, i) => (
              <li key={p.id} className="relative flex gap-3 pb-4 last:pb-0">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i === 0 ? "bg-emerald-500" : "bg-slate-300"}`} />
                <div>
                  <p className="font-medium text-slate-800">
                    v{p.version_number} went live
                    {p.previous_number !== null && p.previous_number > p.version_number && <span className="font-normal text-amber-700"> (rollback)</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {p.published_by_name ?? "System"} · {ago(p.published_at)}
                    {p.previous_number !== null && <> · replaced v{p.previous_number}</>}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <Card className="p-5 text-sm">
          <p className="flex items-center gap-2 font-medium text-slate-900"><Icon name="code" className="text-slate-500" /> Prefer code?</p>
          <p className="mt-1 text-slate-500">Ejecting to Git and importing a codebase back as a version is on the way. Your versions history carries over.</p>
        </Card>
      </aside>
    </div>
  );
}
