import { COLOR_KEYS, FONTS, MOTIONS } from "@zsite/core";
import {
  CURRENT_RUNTIME,
  config,
  EXPORT_FRESH_HOURS,
  MAX_DOMAINS_PER_SITE,
  deletionCheck,
  domainProvider,
  domainTarget,
  getGitLink,
  getSite,
  isApex,
  isPlatformAdmin,
  isPlatformHost,
  latestVersion,
  listDomains,
  listIntegrations,
  siteInventory,
  withTenant,
} from "@zsite/platform";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, Dl, Icon, buttonClass } from "@/components/ui";
import { ago, dateTime } from "@/lib/format";
import { requireSession } from "@/lib/session";
import {
  addDomainAction,
  brandAction,
  checkDomainAction,
  connectGitAction,
  deleteSiteAction,
  disconnectGitAction,
  importBranchAction,
  inventoryAction,
  removeDomainAction,
  renameAction,
} from "../../actions";

export const metadata = { title: "Site settings" };

const KIND_LABELS = { landing: "Landing page", portfolio: "Portfolio", store: "Online store" } as const;
const COLOR_LABELS: Record<string, string> = {
  primary: "Primary",
  accent: "Accent",
  background: "Background",
  surface: "Panels",
  text: "Text",
  muted: "Secondary text",
};
const DOMAIN_TONE = { pending: "gray", verifying: "amber", active: "green", failed: "red" } as const;

function Record({ type, name, value }: { type: string; name: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-lg bg-slate-50 p-3 text-xs ring-1 ring-slate-200 sm:grid-cols-[60px_1fr]">
      <span className="font-semibold text-slate-500">{type}</span>
      <div className="min-w-0 space-y-1">
        <p className="break-all"><span className="text-slate-500">Name </span><code className="select-all font-mono text-slate-900">{name}</code></p>
        <p className="break-all"><span className="text-slate-500">Value </span><code className="select-all font-mono text-slate-900">{value}</code></p>
      </div>
    </div>
  );
}

export default async function SettingsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const session = await requireSession();
  const { site, domains, git, deletion, integrations, inventory, theme } = await withTenant(session.tenant.id, async (tx) => ({
    site: await getSite(tx, siteId),
    domains: await listDomains(tx, siteId),
    git: await getGitLink(tx, siteId),
    deletion: await deletionCheck(tx, siteId),
    integrations: (await listIntegrations(tx)).filter((i) => i.status !== "disconnected"),
    inventory: await siteInventory(tx, siteId),
    theme: (await latestVersion(tx, siteId)).tree?.theme,
  }));
  const brand = site.brand;
  const target = domainTarget();
  const managedTls = Boolean(domainProvider());
  const canDelete = session.role !== "editor";
  const platformAdmin = await isPlatformAdmin(session.user.id);
  const platformHosts = [config.platformDomain(), `www.${config.platformDomain()}`];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="General" description="The site's name and what kind of site it is." />
        <ActionForm action={renameAction} className="space-y-4 p-5">
          <input type="hidden" name="siteId" value={site.id} />
          <div>
            <label className="label" htmlFor="name">Site name</label>
            <input id="name" name="name" defaultValue={site.name} className="field" required />
          </div>
          <div>
            <label className="label" htmlFor="kind">Type</label>
            <select id="kind" name="kind" defaultValue={site.kind} className="field">
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            <p className="help">
              Only online stores sell: switching away from a store hides its products and stops new orders (existing orders stay).
              The AI builds to the type you choose.
            </p>
          </div>
          <SubmitButton pending="Saving…">Save</SubmitButton>
        </ActionForm>
      </Card>

      {site.kind === "store" ? (
        <Card>
          <CardHeader title="Inventory" description="Who manages what this store sells, and its stock." />
          <ActionForm action={inventoryAction} className="space-y-3 p-5">
            <input type="hidden" name="siteId" value={site.id} />
            <label className="flex gap-3 rounded-lg border border-slate-200 p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/50">
              <input type="radio" name="inventory" value="studio" defaultChecked={inventory.inventory === "studio"} className="mt-1" />
              <span className="text-sm"><strong className="text-slate-900">Zuuvy Studio</strong><br /><span className="text-slate-600">Add products and stock under Products. Accepting an order takes it off stock; cancelling puts it back.</span></span>
            </label>
            {(integrations.length ? integrations : [{ kind: "zuuvy", status: "disconnected" as const }]).map((i) => (
              <label key={i.kind} className="flex gap-3 rounded-lg border border-slate-200 p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/50">
                <input type="radio" name="inventory" value={`source:${i.kind}`} defaultChecked={inventory.inventory === "source" && inventory.inventory_source === i.kind} className="mt-1" />
                <span className="text-sm">
                  <strong className="text-slate-900">Data source: {i.kind === "zuuvy" ? "Zuuvy" : i.kind}</strong>{" "}
                  {i.status === "disconnected" && <Badge tone="amber">not connected</Badge>}
                  <br />
                  <span className="text-slate-600">Products, prices and stock come from there; orders go to it and it says what happens next.</span>
                </span>
              </label>
            ))}
            <label className="flex gap-3 rounded-lg border border-slate-200 p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/50">
              <input type="radio" name="inventory" value="none" defaultChecked={inventory.inventory === "none"} className="mt-1" />
              <span className="text-sm"><strong className="text-slate-900">None</strong><br /><span className="text-slate-600">Products are added here but stock is not counted — nothing ever shows as sold out.</span></span>
            </label>
            <fieldset className="space-y-2 border-t border-slate-100 pt-4">
              <legend className="label">When a product is out of stock</legend>
              {(
                [
                  ["show", "Show it, marked out of stock", "Customers see it but cannot order it."],
                  ["hide", "Hide it", "It leaves the store until stock is back."],
                  ["sell", "Keep selling it", "Customers can still order; it shows as made to order and you source it. Accepting takes whatever stock there is."],
                ] as const
              ).map(([value, title, body]) => (
                <label key={value} className="flex gap-3 rounded-lg border border-slate-200 p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/50">
                  <input type="radio" name="outOfStock" value={value} defaultChecked={inventory.out_of_stock === value} className="mt-1" />
                  <span className="text-sm"><strong className="text-slate-900">{title}</strong><br /><span className="text-slate-600">{body}</span></span>
                </label>
              ))}
              <p className="text-xs text-slate-500">
                Does not apply when stock is not counted. With a data source, it can still refuse an order it cannot fill.
              </p>
            </fieldset>
            <SubmitButton pending="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Address" description="Where people find this site." />
          <Dl items={[["Zuuvy address", site.url.replace(/^https?:\/\//, "")], ["Custom domains", String(domains.length)]]} />
        </Card>
      )}

      <Card className="lg:col-span-2">
        <CardHeader
          title={<span className="flex items-center gap-2"><Icon name="palette" className="text-slate-400" /> Brand kit</span>}
          description="What you set here is fixed: the AI designs around it and never changes it. Leave a colour unticked and the AI chooses it. Pictures and animation follow the palette."
        />
        <ActionForm action={brandAction} className="grid gap-6 p-5 lg:grid-cols-2">
          <input type="hidden" name="siteId" value={site.id} />
          <input type="hidden" name="logo_url" value={brand.logo ?? ""} />
          <div className="space-y-4">
            <div>
              <p className="label">Logo</p>
              <div className="flex items-center gap-4">
                {brand.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brand.logo} alt="Logo" className="h-14 w-auto max-w-40 rounded bg-slate-50 object-contain p-1 ring-1 ring-slate-200" />
                ) : (
                  <div className="grid h-14 w-14 place-items-center rounded bg-slate-100 text-xs text-slate-400">None</div>
                )}
                <div className="space-y-1 text-sm">
                  <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" className="block text-sm" />
                  {brand.logo && (
                    <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="remove_logo" value="1" /> Remove the logo</label>
                  )}
                </div>
              </div>
              <p className="help">Shown in the site's header. A transparent PNG works best.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(["heading", "body"] as const).map((k) => (
                <div key={k}>
                  <label className="label" htmlFor={`font_${k}`}>{k === "heading" ? "Heading font" : "Body font"}</label>
                  <select id={`font_${k}`} name={`font_${k}`} defaultValue={brand.fonts[k] ?? ""} className="field">
                    <option value="">AI chooses</option>
                    {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div>
              <label className="label" htmlFor="motion">Animation</label>
              <select id="motion" name="motion" defaultValue={brand.motion ?? ""} className="field">
                <option value="">AI chooses</option>
                {MOTIONS.map((m) => <option key={m} value={m}>{m === "none" ? "None — keep it still" : m === "subtle" ? "Subtle — sections ease in" : "Lively — more movement"}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <p className="label">Colours</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {COLOR_KEYS.map((k) => {
                  const fixed = brand.colors[k];
                  const ai = brand.aiColors?.[k];
                  return (
                    <label key={k} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm">
                      <input type="checkbox" name={`set_${k}`} value="1" defaultChecked={Boolean(fixed)} title="Fix this colour" />
                      <input type="color" name={`color_${k}`} defaultValue={fixed ?? ai ?? theme?.colors[k] ?? "#22314f"} className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" aria-label={COLOR_LABELS[k]} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-slate-800">{COLOR_LABELS[k]}</span>
                        <span className="block text-xs text-slate-500">{fixed ? "Fixed by you" : ai ? `AI chose ${ai}` : `AI chooses · now ${theme?.colors[k] ?? "—"}`}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="help">Tick a colour to fix it. Text on your colours stays readable automatically.</p>
            </div>
            <div>
              <label className="label" htmlFor="guidelines">Brand guidelines <span className="font-normal text-slate-400">(optional)</span></label>
              <textarea id="guidelines" name="guidelines" rows={4} defaultValue={brand.guidelines ?? ""} className="field" placeholder="Voice, audience, words to use or avoid — “Warm and plain-spoken. We say ‘genuine’, never ‘cheap’. Customers are families in Patna.”" />
            </div>
          </div>
          <div className="lg:col-span-2">
            <SubmitButton pending="Saving…">Save brand kit</SubmitButton>
            <span className="ml-3 text-xs text-slate-500">Saving applies it as a new version for you to preview and publish.</span>
          </div>
        </ActionForm>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader
          title={<span className="flex items-center gap-2"><Icon name="link" className="text-slate-400" /> Custom domains</span>}
          description={`Show this site at your own address, like www.yourbusiness.in — over HTTPS, with no change to your nameservers. Up to ${MAX_DOMAINS_PER_SITE}.`}
        />
        <div className="space-y-4 p-5">
          <ActionForm action={addDomainAction} className="flex flex-wrap gap-2" resetOnOk>
            <input type="hidden" name="siteId" value={site.id} />
            <input name="hostname" required placeholder="www.yourbusiness.in" className="field max-w-sm" />
            <SubmitButton pending="Adding…" variant="secondary">Add domain</SubmitButton>
          </ActionForm>
          {platformAdmin && (
            <p className="text-xs text-slate-500">
              As a platform admin you can also connect <code>{platformHosts[0]}</code> or <code>{platformHosts[1]}</code> — the platform's own root, for its landing page.
              It needs no certificate; it goes live once it points at the load balancer.
            </p>
          )}
          {domains.length === 0 && <p className="text-sm text-slate-500">No custom domain yet. This site is at <strong>{site.url.replace(/^https?:\/\//, "")}</strong>.</p>}
          {domains.map((d) => (
            <div key={d.id} className="space-y-3 rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-slate-900">{d.hostname}</p>
                <Badge tone={DOMAIN_TONE[d.status]}>{d.status === "active" ? "Connected" : d.status === "verifying" ? "Waiting for DNS" : d.status === "failed" ? "Not connected" : "Setting up"}</Badge>
                {d.checked_at && <span className="text-xs text-slate-500">checked {ago(d.checked_at)}</span>}
                <div className="ml-auto flex gap-2">
                  {d.status !== "active" && (
                    <ActionForm action={checkDomainAction}>
                      <input type="hidden" name="siteId" value={site.id} />
                      <input type="hidden" name="domainId" value={d.id} />
                      <SubmitButton size="sm" variant="secondary" pending="…"><Icon name="refresh" /> Check again</SubmitButton>
                    </ActionForm>
                  )}
                  <ActionForm action={removeDomainAction}>
                    <input type="hidden" name="siteId" value={site.id} />
                    <input type="hidden" name="domainId" value={d.id} />
                    <SubmitButton size="sm" variant="danger" pending="…" confirm={`Disconnect ${d.hostname}?`}>Remove</SubmitButton>
                  </ActionForm>
                </div>
              </div>
              {d.status === "active" ? (
                <p className="text-sm text-emerald-700">Live at <a className="underline" href={`https://${d.hostname}`} target="_blank" rel="noreferrer">https://{d.hostname}</a>{d.verified_at && ` since ${dateTime(d.verified_at)}`}.</p>
              ) : (
                <>
                  <p className="text-sm text-slate-600">At the company where you manage this domain's DNS (GoDaddy, Hostinger, Cloudflare…), add {managedTls ? "these two records" : "this record"}:</p>
                  {managedTls && !isPlatformHost(d.hostname) &&
                    (d.validation_name && d.validation_value ? (
                      <Record type="CNAME" name={d.validation_name.replace(/\.$/, "")} value={d.validation_value.replace(/\.$/, "")} />
                    ) : (
                      <p className="text-xs text-slate-500">Preparing the security certificate… its record appears here in a few seconds (refresh).</p>
                    ))}
                  {isPlatformHost(d.hostname) ? (
                    <p className="text-xs text-slate-600">Point {d.hostname} at the load balancer at Hostinger (it already is if zuuvy.site showed “There is no site here”).</p>
                  ) : (
                    <Record type="CNAME" name={d.hostname} value={target} />
                  )}
                  {isApex(d.hostname) && !isPlatformHost(d.hostname) && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
                      {d.hostname} is a bare domain, and most DNS providers do not allow a CNAME there. Use <strong>www.{d.hostname}</strong> instead and set up a
                      redirect from {d.hostname} to it at your provider — or, if your provider offers “CNAME flattening” or an ALIAS record (Cloudflare does), use that.
                    </p>
                  )}
                  {d.last_error && <p className="text-xs text-slate-600">Last check: {d.last_error}</p>}
                  <p className="text-xs text-slate-500">DNS changes usually show within minutes, sometimes a few hours. We check automatically for 3 days.</p>
                </>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Icon name="git" className="text-slate-400" /> GitHub</span>}
          description="Every new version becomes a branch (zuuvy/v12). Publishing a version makes the main branch that version, as a merge."
        />
        {git ? (
          <div className="space-y-4 p-5 text-sm">
            <Dl
              items={[
                ["Repository", <a key="r" className="text-brand-700 underline" href={`https://github.com/${git.owner}/${git.repo}`} target="_blank" rel="noreferrer">{git.owner}/{git.repo}</a>],
                ["Main branch", git.default_branch],
                ["Status", git.status === "active" ? <Badge key="s" tone="green">Syncing</Badge> : <Badge key="s" tone="red">Needs attention</Badge>],
                ["Last synced", ago(git.last_synced_at)],
              ]}
            />
            {git.last_error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-800 ring-1 ring-rose-200">{git.last_error}</p>}
            <ActionForm action={importBranchAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="siteId" value={site.id} />
              <input name="branch" required placeholder="Branch to import, e.g. my-edits" className="field max-w-xs" />
              <SubmitButton size="sm" variant="secondary" pending="Importing…"><Icon name="download" /> Import from branch</SubmitButton>
            </ActionForm>
            <ActionForm action={disconnectGitAction}>
              <input type="hidden" name="siteId" value={site.id} />
              <SubmitButton size="sm" variant="ghost" pending="…" confirm="Stop syncing with GitHub? Nothing in the repository is deleted.">Disconnect</SubmitButton>
            </ActionForm>
          </div>
        ) : (
          <ActionForm action={connectGitAction} className="space-y-3 p-5">
            <input type="hidden" name="siteId" value={site.id} />
            <input name="repo" required placeholder="owner/repository — an empty repository is fine" className="field" />
            <input name="token" required type="password" autoComplete="off" placeholder="Fine-grained token (github_pat_…)" className="field" />
            <p className="help">
              GitHub → Settings → Developer settings → Fine-grained tokens: choose only this repository, with <strong>Contents: Read and write</strong>.
              It is stored encrypted.
            </p>
            <SubmitButton pending="Connecting…">Connect GitHub</SubmitButton>
          </ActionForm>
        )}
      </Card>

      <Card>
        <CardHeader title="Export" description="Everything about this site in one zip: every version, its content, pictures, publish history, domains and the orders placed through it." />
        <div className="space-y-3 p-5 text-sm">
          <a href={`/sites/${site.id}/export`} className={buttonClass("secondary")}><Icon name="download" /> Download site export</a>
          <p className="text-xs text-slate-500">
            Last export: {deletion.exportedAt ? dateTime(deletion.exportedAt) : "never"}. Import it as a new site from Sites → New site; export one version's source from its page.
          </p>
        </div>
      </Card>

      <Card className="border-rose-200 lg:col-span-2">
        <CardHeader title={<span className="text-rose-700">Delete this site</span>} description="Removes the site, every version and its domains for good. Orders placed through it and your media library are kept." />
        <div className="space-y-3 p-5 text-sm">
          <ol className="list-decimal space-y-1 pl-5 text-slate-700">
            <li className={deletion.ok ? "text-emerald-700" : ""}>
              Download the site export {deletion.ok ? "— done ✓" : <>— required, and it must hold every version and be less than {EXPORT_FRESH_HOURS} hours old. <a className="text-brand-700 underline" href={`/sites/${site.id}/export`}>Download it now</a>, then refresh this page.</>}
            </li>
            <li>Type the site's name to confirm.</li>
          </ol>
          {!canDelete ? (
            <p className="text-slate-500">Only an owner or admin can delete a site.</p>
          ) : (
            <ActionForm action={deleteSiteAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="siteId" value={site.id} />
              <input name="confirm" required placeholder={site.name} className="field max-w-xs" disabled={!deletion.ok} autoComplete="off" />
              <SubmitButton variant="danger" pending="Deleting…" confirm={`Delete ${site.name} permanently?`}>
                <Icon name="trash" /> Delete site
              </SubmitButton>
            </ActionForm>
          )}
          {!deletion.ok && deletion.reason && <p className="text-xs text-slate-500">{deletion.reason}</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Runtime" description="The component library this site renders with. You choose when to upgrade." />
        <Dl
          items={[
            ["Current", `Runtime ${site.runtime_version}`],
            ["Newest available", `Runtime ${CURRENT_RUNTIME}`],
            ["Status", site.runtime_version === CURRENT_RUNTIME ? <Badge key="s" tone="green">Up to date</Badge> : <Badge key="s" tone="amber">Upgrade available</Badge>],
          ]}
        />
      </Card>

      <Card>
        <CardHeader title="Details" />
        <Dl items={[["Type", KIND_LABELS[site.kind]], ["Created", dateTime(site.created_at)], ["Versions", String(site.latest_number)], ["Site id", <code key="i" className="text-xs">{site.id}</code>]]} />
      </Card>
    </div>
  );
}
