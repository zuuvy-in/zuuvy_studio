import { COLLECTIONS, type CollectionSpec, type DataItem, type FieldSpec, itemTitle } from "@zsite/core";
import { getSite, latestVersion, listAssets, withTenant } from "@zsite/platform";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, Icon } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { moveEntryAction, removeEntryAction, saveEntryAction } from "./actions";

export const metadata = { title: "Content" };

function Field({ f, value }: { f: FieldSpec; value: unknown }) {
  const id = `f_${f.key}`;
  const v = Array.isArray(value) ? value.join(", ") : value === undefined || value === null ? "" : String(value);
  const common = { id, name: id, defaultValue: v, required: f.required, className: "field" };
  return (
    <div className={f.kind === "textarea" ? "sm:col-span-2" : ""}>
      <label className="label" htmlFor={id}>
        {f.label} {!f.required && <span className="font-normal text-slate-400">(optional)</span>}
      </label>
      {f.kind === "textarea" ? (
        <textarea {...common} rows={4} maxLength={f.max} />
      ) : (
        <input
          {...common}
          type={f.kind === "email" ? "email" : f.kind === "year" ? "number" : f.kind === "url" || f.kind === "image" ? "url" : "text"}
          list={f.kind === "image" ? "media-urls" : undefined}
          maxLength={f.max}
          placeholder={f.kind === "tags" ? "Comma, separated" : f.kind === "image" ? "https://… or pick from your media library" : undefined}
        />
      )}
    </div>
  );
}

function EntryForm({ siteId, spec, item, exists }: { siteId: string; spec: CollectionSpec; item?: DataItem; exists?: boolean }) {
  return (
    <ActionForm action={saveEntryAction} className="grid gap-4 sm:grid-cols-2" resetOnOk={!item}>
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="collection" value={spec.key} />
      {item?.id && <input type="hidden" name="id" value={item.id} />}
      {exists && <input type="hidden" name="exists" value="1" />}
      {spec.fields.map((f) => (
        <Field key={f.key} f={f} value={item?.[f.key]} />
      ))}
      <div className="sm:col-span-2">
        <SubmitButton size="sm" pending="Saving…">{item ? "Save changes" : `Add to ${spec.label}`}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export default async function ContentPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const session = await requireSession();
  const { site, head, media } = await withTenant(session.tenant.id, async (tx) => ({
    site: await getSite(tx, siteId),
    head: await latestVersion(tx, siteId),
    media: await listAssets(tx, 100),
  }));
  const usesCollections = (head.tree?.pages ?? []).some((p) => p.sections.some((s) => s.type === "collection"));
  if (site.kind !== "portfolio" && !usesCollections) notFound();
  const data = head.data ?? {};
  const shown = new Set(
    (head.tree?.pages ?? []).flatMap((p) => p.sections).filter((s) => s.type === "collection").map((s) => (s.props as { collection: string }).collection),
  );
  // Portfolio sections first for a portfolio; everything is available to every kind of site.
  const specs = [...COLLECTIONS].sort((a, b) => Number(shown.has(b.key)) - Number(shown.has(a.key)));

  return (
    <div className="space-y-6">
      <datalist id="media-urls">
        {media.map((m) => (
          <option key={m.id} value={m.url}>{m.alt || m.kind}</option>
        ))}
      </datalist>
      <Card className="flex flex-col gap-2 p-5 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <p>
          The facts your portfolio shows — profile, projects, experience and more — kept as tables.
          Edit them here or ask the AI. <strong className="text-slate-800">Every save is a new version of v{head.number}</strong>, so the
          version before it is your backup; restoring a version lets you reset any of these tables from it.
        </p>
        <Badge tone="brand" className="shrink-0">Editing on top of v{head.number}</Badge>
      </Card>

      {specs.map((spec) => {
        const items = data[spec.key] ?? [];
        return (
          <Card key={spec.key} id={spec.key}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Icon name="table" className="text-slate-400" /> {spec.label}
                  <Badge>{spec.single ? (items.length ? "set" : "empty") : `${items.length}`}</Badge>
                  {shown.has(spec.key) ? <Badge tone="green">On the site</Badge> : <Badge tone="gray">Not on a page yet</Badge>}
                </span>
              }
              description={spec.description}
            />
            {spec.single ? (
              <div className="p-5">
                <EntryForm siteId={site.id} spec={spec} item={items[0]} exists={items.length > 0} />
              </div>
            ) : (
              <>
                <ul className="divide-y divide-slate-100">
                  {items.map((item, i) => (
                    <li key={item.id} className="px-5 py-3">
                      <details>
                        <summary className="flex cursor-pointer list-none items-center gap-3">
                          <span className="font-mono text-xs text-slate-400">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{itemTitle(spec.key, item)}</span>
                          <span className="text-xs text-brand-700">Edit</span>
                        </summary>
                        <div className="mt-4 space-y-4">
                          <EntryForm siteId={site.id} spec={spec} item={item} />
                          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                            {i > 0 && (
                              <ActionForm action={moveEntryAction}>
                                <input type="hidden" name="siteId" value={site.id} />
                                <input type="hidden" name="collection" value={spec.key} />
                                <input type="hidden" name="id" value={item.id} />
                                <input type="hidden" name="index" value={i - 1} />
                                <SubmitButton size="sm" variant="secondary" pending="Moving…">Move up</SubmitButton>
                              </ActionForm>
                            )}
                            <ActionForm action={removeEntryAction}>
                              <input type="hidden" name="siteId" value={site.id} />
                              <input type="hidden" name="collection" value={spec.key} />
                              <input type="hidden" name="id" value={item.id} />
                              <SubmitButton size="sm" variant="danger" pending="Removing…" confirm={`Remove “${itemTitle(spec.key, item)}”? It stays in earlier versions.`}>
                                <Icon name="trash" /> Remove
                              </SubmitButton>
                            </ActionForm>
                          </div>
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
                <details className="border-t border-slate-100 px-5 py-4">
                  <summary className="cursor-pointer text-sm font-medium text-brand-700">+ Add to {spec.label}</summary>
                  <div className="mt-4">
                    <EntryForm siteId={site.id} spec={spec} />
                  </div>
                </details>
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
