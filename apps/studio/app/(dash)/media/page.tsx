import { imageGenerationEnabled, listAssets, storage, withTenant } from "@zsite/platform";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, EmptyState, Icon, PageHeader } from "@/components/ui";
import { ago } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { altAction, deleteAction, generateAction, uploadAction } from "./actions";

export const metadata = { title: "Media" };

export default async function MediaPage() {
  const session = await requireSession();
  const assets = await withTenant(session.tenant.id, (tx) => listAssets(tx, 200));
  const canStore = Boolean(storage());
  const canGenerate = imageGenerationEnabled();
  return (
    <>
      <PageHeader
        title="Media"
        description="Your pictures: photos you upload and ones the AI makes. The AI places these on your sites before it makes anything new — describe them so it knows what each one shows."
      />
      {!canStore && (
        <p className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          Picture storage is not configured on this server (ASSETS_BUCKET), so uploads and generated pictures are off.
        </p>
      )}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upload" description="JPEG, PNG, WebP or GIF, up to 5 MB each." />
          <ActionForm action={uploadAction} className="space-y-3 p-5" resetOnOk>
            <input type="file" name="files" multiple accept="image/jpeg,image/png,image/webp,image/gif" className="block w-full text-sm" disabled={!canStore} />
            <input name="alt" className="field" placeholder="What they show (optional) — “Our shop front in Boring Road”" disabled={!canStore} />
            <SubmitButton pending="Uploading…" variant="secondary"><Icon name="upload" /> Upload</SubmitButton>
          </ActionForm>
        </Card>
        <Card>
          <CardHeader title="Create with AI" description="Amazon Nova 2 Omni. No text or logos in pictures; real people's faces are avoided." />
          <ActionForm action={generateAction} className="space-y-3 p-5" resetOnOk>
            <textarea name="prompt" rows={2} className="field" placeholder="A bright, tidy mobile accessories shop counter with neatly arranged phone cases, warm morning light" disabled={!canGenerate} />
            <div className="flex flex-wrap gap-2">
              <select name="aspect" className="field w-auto" disabled={!canGenerate}>
                <option value="wide">Wide (hero)</option>
                <option value="landscape">Landscape</option>
                <option value="square">Square</option>
                <option value="portrait">Portrait</option>
              </select>
              <select name="style" className="field w-auto" disabled={!canGenerate}>
                <option value="photo">Photo</option>
                <option value="illustration">Illustration</option>
                <option value="flat">Flat illustration</option>
                <option value="3d">3D</option>
              </select>
              <SubmitButton pending="Creating… (about 10 seconds)"><Icon name="sparkles" /> Create picture</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
      <Card>
        {assets.length === 0 ? (
          <EmptyState icon="image" title="No pictures yet" body="Upload your own, create one here, or ask the AI to add pictures while it edits a site." />
        ) : (
          <ul className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            {assets.map((a) => (
              <li key={a.id} className="overflow-hidden rounded-lg border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.url} alt={a.alt} className="aspect-[4/3] w-full bg-slate-100 object-cover" loading="lazy" />
                <div className="space-y-2 p-3">
                  <div className="flex items-center gap-2">
                    <Badge tone={a.kind === "generated" ? "violet" : "gray"}>{a.kind === "generated" ? "AI" : "Upload"}</Badge>
                    <span className="text-xs text-slate-500">{ago(a.created_at)}</span>
                  </div>
                  <ActionForm action={altAction} className="flex gap-2">
                    <input type="hidden" name="id" value={a.id} />
                    <input name="alt" defaultValue={a.alt} className="field py-1 text-xs" aria-label="Description" placeholder="Describe it" />
                    <SubmitButton size="sm" variant="secondary" pending="…">Save</SubmitButton>
                  </ActionForm>
                  <div className="flex items-center gap-2">
                    <input readOnly value={a.url} className="field py-1 font-mono text-[11px]" aria-label="Picture URL" />
                    <ActionForm action={deleteAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <SubmitButton size="sm" variant="danger" pending="…" confirm="Delete this picture? A site still showing it will show a placeholder instead.">
                        <Icon name="trash" />
                      </SubmitButton>
                    </ActionForm>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
