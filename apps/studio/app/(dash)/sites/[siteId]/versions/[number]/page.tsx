import { aiConfigured } from "@zsite/ai";
import { diffTrees } from "@zsite/core";
import { NotFound, getSite, getVersion, getVersionByNumber, latestVersion, withTenant } from "@zsite/platform";
import { notFound } from "next/navigation";
import { SourceBadge } from "@/components/badges";
import { ChangeList } from "@/components/changes";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Composer, PreviewFrame } from "@/components/site";
import { Badge, ButtonLink, Card, CardHeader, Dl, Icon } from "@/components/ui";
import { ago, dateTime } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { generateAction, publishAction, restoreAction } from "../../../actions";

export default async function VersionPage({ params }: { params: Promise<{ siteId: string; number: string }> }) {
  const { siteId, number: raw } = await params;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1) notFound();
  const session = await requireSession();
  const data = await withTenant(session.tenant.id, async (tx) => {
    const site = await getSite(tx, siteId);
    const version = await getVersionByNumber(tx, siteId, number);
    const parent = version.parent_id ? await getVersion(tx, siteId, version.parent_id) : null;
    const latest = await latestVersion(tx, siteId);
    return { site, version, parent, latest };
  }).catch((e) => {
    if (e instanceof NotFound) notFound();
    throw e;
  });
  const { site, version, parent, latest } = data;
  const changes = parent?.tree && version.tree ? diffTrees(parent.tree, version.tree) : [];
  const meta = version.ai_meta as { model?: string; operations?: number; usage?: { input_tokens: number; output_tokens: number } } | null;
  const pages = version.tree?.pages.map((p) => ({ path: p.path, title: p.title })) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Version {version.number}</h2>
          <SourceBadge source={version.source} />
          {version.is_published && <Badge tone="green"><Icon name="check" className="h-3 w-3" /> Live</Badge>}
          {version.id === latest.id && <Badge tone="gray">Latest</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {site.published_number && site.published_number !== version.number && (
            <ButtonLink href={`/sites/${site.id}/versions/compare?from=${site.published_number}&to=${version.number}`} variant="secondary">
              <Icon name="compare" /> Compare with live
            </ButtonLink>
          )}
          {version.id !== latest.id && (
            <ActionForm action={restoreAction}>
              <input type="hidden" name="siteId" value={site.id} />
              <input type="hidden" name="number" value={version.number} />
              <SubmitButton variant="secondary" pending="Restoring…"><Icon name="history" /> Restore as latest</SubmitButton>
            </ActionForm>
          )}
          {!version.is_published && (
            <ActionForm action={publishAction}>
              <input type="hidden" name="siteId" value={site.id} />
              <input type="hidden" name="number" value={version.number} />
              <SubmitButton pending="Publishing…" confirm={`Publish version ${version.number} to ${site.url}?`}>
                {site.published_number && site.published_number > version.number ? "Roll back to this version" : "Publish"}
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {version.tree ? (
            <PreviewFrame base={`/preview/${site.id}/${version.number}`} pages={pages} title={`Preview of version ${version.number}`} />
          ) : (
            <Card className="p-8 text-sm text-slate-600">This is a code version ({version.git_ref}); previews of code versions come with Git import.</Card>
          )}
          <Composer action={generateAction} siteId={site.id} baseNumber={version.number} aiReady={aiConfigured()} title={`Continue from v${version.number}`} />
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="About this version" />
            {version.prompt && (
              <div className="border-b border-slate-100 px-5 py-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Asked for</p>
                <p className="mt-1 text-sm text-slate-800">“{version.prompt}”</p>
              </div>
            )}
            <div className="border-b border-slate-100 px-5 py-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Summary</p>
              <p className="mt-1 text-sm text-slate-800">{version.summary}</p>
            </div>
            <Dl
              items={[
                ["Created", <time key="t" title={dateTime(version.created_at)}>{ago(version.created_at)}</time>],
                ["By", version.created_by_name ?? "System"],
                ["Based on", version.parent_number ? `v${version.parent_number}` : "—"],
                ["Runtime", version.runtime_version],
                ...(meta?.model ? ([["Model", meta.model]] as [string, string][]) : []),
                ...(meta?.operations ? ([["Edits made", String(meta.operations)]] as [string, string][]) : []),
              ]}
            />
          </Card>
          <Card>
            <CardHeader title={parent ? `Changes from v${parent.number}` : "Changes"} />
            <ChangeList changes={changes} empty={parent ? "Identical to its parent." : "The first version of this site."} />
          </Card>
        </aside>
      </div>
    </div>
  );
}
