import { collectionSpec, diffData, diffTrees } from "@zsite/core";
import { ATTACHMENT_ACCEPT, NotFound, type StoredProposal, getSite, getVersion, getVersionByNumber, latestVersion, listSiteTables, withTenant } from "@zsite/platform";
import { notFound } from "next/navigation";
import { SourceBadge } from "@/components/badges";
import { ChangeList } from "@/components/changes";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Composer, PreviewFrame } from "@/components/site";
import { Badge, ButtonLink, Card, CardHeader, Dl, Icon, buttonClass } from "@/components/ui";
import { ago, dateTime } from "@/lib/format";
import { aiStatus } from "@/lib/ai";
import { requireSession } from "@/lib/session";
import { applyProposalsAction, generateAction, planAction, publishAction, restoreAction } from "../../../actions";
import { deleteTableAction } from "../../data/actions";

export default async function VersionPage({ params }: { params: Promise<{ siteId: string; number: string }> }) {
  const { siteId, number: raw } = await params;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1) notFound();
  const session = await requireSession();
  const ai = aiStatus();
  const data = await withTenant(session.tenant.id, async (tx) => {
    const site = await getSite(tx, siteId);
    const version = await getVersionByNumber(tx, siteId, number);
    const parent = version.parent_id ? await getVersion(tx, siteId, version.parent_id) : null;
    const latest = await latestVersion(tx, siteId);
    const tables = await listSiteTables(tx, siteId);
    return { site, version, parent, latest, tables };
  }).catch((e) => {
    if (e instanceof NotFound) notFound();
    throw e;
  });
  const { site, version, parent, latest, tables } = data;
  // Tables the AI asked to delete that still exist: held for the owner, since rows are people's messages.
  const heldDeletes = ((version.ai_meta as { tableDeletes?: { key: string; reason: string }[] } | null)?.tableDeletes ?? [])
    .map((d) => ({ ...d, table: tables.find((t) => t.key === d.key) }))
    .filter((d) => d.table);
  const changes = parent?.tree && version.tree ? diffTrees(parent.tree, version.tree) : [];
  const dataChanges = parent ? diffData(parent.data, version.data) : [];
  // What restoring this version could reset: tables where the latest version differs from this one.
  const restorable = version.id !== latest.id ? diffData(latest.data, version.data) : [];
  const layoutDiffers = version.id !== latest.id && latest.tree && version.tree ? diffTrees(latest.tree, version.tree).length > 0 : false;
  const proposals = ((version.ai_meta as { proposals?: StoredProposal[] } | null)?.proposals ?? []);
  const meta = version.ai_meta as { provider?: string; model?: string; operations?: number; usage?: { input_tokens: number; output_tokens: number } } | null;
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
          {version.tree && (
            <a href={`/sites/${site.id}/versions/${version.number}/source`} className={buttonClass("secondary")}>
              <Icon name="code" /> Export source
            </a>
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

      {proposals.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardHeader
            title="The AI wants to change existing content — allow it?"
            description="These changes touch data you already had, so they were held back. Tick the ones to allow; they are saved as a new version on top of the latest, and nothing else changes."
          />
          <ActionForm action={applyProposalsAction} className="space-y-2 p-5">
            <input type="hidden" name="siteId" value={site.id} />
            <input type="hidden" name="number" value={version.number} />
            {proposals.map((p, i) => (
              <label key={i} className="flex items-start gap-3 rounded-lg bg-white p-3 text-sm ring-1 ring-amber-200">
                <input type="checkbox" name="proposal" value={i} defaultChecked className="mt-0.5" />
                <span>
                  <span className="font-medium text-slate-900">{p.description}</span>
                  {"fields" in p.op && (
                    <span className="mt-1 block text-xs text-slate-600">
                      {Object.entries(p.op.fields).map(([k, v]) => `${k}: ${v === null || v === "" ? "(cleared)" : Array.isArray(v) ? v.join(", ") : String(v)}`).join(" · ").slice(0, 400)}
                    </span>
                  )}
                </span>
              </label>
            ))}
            <SubmitButton pending="Applying…">Allow selected changes</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {heldDeletes.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardHeader
            title="The AI suggests deleting form tables"
            description="Tables hold what visitors sent, so the AI never deletes one itself. Delete it here, or leave it — keeping it changes nothing."
          />
          <div className="space-y-2 p-5 pt-0">
            {heldDeletes.map((d) => (
              <ActionForm key={d.key} action={deleteTableAction} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3 text-sm ring-1 ring-amber-200">
                <input type="hidden" name="siteId" value={site.id} />
                <input type="hidden" name="table" value={d.table!.id} />
                <input type="hidden" name="back" value={`/sites/${site.id}/versions/${version.number}`} />
                <span>
                  <span className="font-medium text-slate-900">{d.table!.name}</span>{" "}
                  <span className="text-slate-500">({d.table!.rows ?? 0} answers)</span>
                  <span className="block text-xs text-slate-600">{d.reason}</span>
                </span>
                <SubmitButton variant="danger" size="sm" pending="Deleting…" confirm={`Delete ${d.table!.name} and its ${d.table!.rows ?? 0} answers?`}>Delete table</SubmitButton>
              </ActionForm>
            ))}
          </div>
        </Card>
      )}

      {version.id !== latest.id && version.tree && (
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Icon name="history" className="text-slate-400" /> Go back to this version</span>}
            description={`Brings this version back as a new latest version (v${latest.number} stays in the history). Choose what to take from v${version.number}.`}
          />
          <ActionForm action={restoreAction} className="space-y-3 p-5">
            <input type="hidden" name="siteId" value={site.id} />
            <input type="hidden" name="number" value={version.number} />
            <input type="hidden" name="choose" value="1" />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                <input type="checkbox" name="layout" value="1" defaultChecked={layoutDiffers} className="mt-0.5" />
                <span><strong className="text-slate-900">Layout, design and copy</strong><br /><span className="text-xs text-slate-500">{layoutDiffers ? "Pages, sections, theme, header and footer" : "Same as the latest"}</span></span>
              </label>
              {restorable.map((c) => (
                <label key={c.collection} className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                  <input type="checkbox" name="tables" value={c.collection} className="mt-0.5" />
                  <span>
                    <strong className="text-slate-900">Reset {collectionSpec(c.collection)?.label ?? c.label}</strong>
                    <br />
                    <span className="text-xs text-slate-500">
                      {[c.removed.length && `${c.removed.length} added since would go`, c.added.length && `${c.added.length} removed since would return`, c.changed.length && `${c.changed.length} edited since would revert`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {restorable.length === 0 && <p className="text-xs text-slate-500">The content tables are the same in both versions.</p>}
            <SubmitButton variant="secondary" pending="Restoring…">Restore what I picked</SubmitButton>
          </ActionForm>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {version.tree ? (
            <PreviewFrame
              base={`/preview/${site.id}/${version.number}`}
              pages={pages}
              title={`Preview of version ${version.number}`}
              feedback={{ siteId: site.id, baseNumber: version.number, action: generateAction, aiReady: ai.ready }}
            />
          ) : (
            <Card className="p-8 text-sm text-slate-600">This is a code version ({version.git_ref}); previews of code versions come with Git import.</Card>
          )}
          <Composer action={generateAction} plan={planAction} siteId={site.id} baseNumber={version.number} aiReady={ai.ready} setupHint={ai.hint} accept={ATTACHMENT_ACCEPT} title={`Continue from v${version.number}`} />
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
                ...(meta?.model ? ([["Model", meta.provider === "bedrock" ? `${meta.model} (Bedrock)` : meta.model]] as [string, string][]) : []),
                ...(meta?.operations ? ([["Edits made", String(meta.operations)]] as [string, string][]) : []),
              ]}
            />
          </Card>
          <Card>
            <CardHeader title={parent ? `Changes from v${parent.number}` : "Changes"} />
            <ChangeList changes={changes} empty={parent ? (dataChanges.length ? "Layout unchanged." : "Identical to its parent.") : "The first version of this site."} />
            {dataChanges.length > 0 && (
              <ul className="space-y-2 border-t border-slate-100 px-5 py-4 text-sm">
                <li className="text-xs font-medium uppercase tracking-wide text-slate-400">Content</li>
                {dataChanges.map((c) => (
                  <li key={c.collection}>
                    <span className="font-medium text-slate-800">{c.label}</span>
                    <span className="text-slate-600">
                      {c.added.length > 0 && ` · added ${c.added.join(", ")}`}
                      {c.changed.length > 0 && ` · changed ${c.changed.join(", ")}`}
                      {c.removed.length > 0 && ` · removed ${c.removed.join(", ")}`}
                    </span>
                  </li>
                ))}
                <li className="text-xs text-slate-500">v{parent?.number} holds the content as it was before — restore from it any time.</li>
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
