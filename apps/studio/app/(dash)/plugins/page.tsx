import { HOOKS, listPlugins, withTenant } from "@zsite/platform";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { ago } from "@/lib/format";
import { pageScope } from "@/lib/scope";
import { requireSession } from "@/lib/session";
import { createPluginAction, deletePluginAction, rotateSecretAction, updatePluginAction } from "./actions";

export const metadata = { title: "Plugins" };

const HOOK_TEXT: Record<(typeof HOOKS)[number], string> = {
  "cart.calculate": "Cart — add a fee or money off, show a message (loyalty points, gift wrap, delivery charge)",
  "checkout.fields": "Checkout — ask extra questions (GSTIN, delivery slot, gift note)",
  "checkout.validate": "Checkout — accept or refuse an order before it is placed (pincode check, fraud check)",
  "order.placed": "After the order — be told about every new order (invoicing, CRM, messaging)",
};

function HookBoxes({ selected }: { selected: string[] }) {
  return (
    <div className="space-y-2 text-sm">
      {HOOKS.map((h) => (
        <label key={h} className="flex items-start gap-2">
          <input type="checkbox" name="hooks" value={h} defaultChecked={selected.includes(h)} className="mt-1" />
          <span>
            <code className="font-mono text-xs text-slate-900">{h}</code>
            <br />
            <span className="text-slate-600">{HOOK_TEXT[h]}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export default async function PluginsPage({ params }: { params: Promise<{ siteId?: string }> }) {
  const session = await requireSession();
  const { siteId, base } = await pageScope(params);
  const plugins = await withTenant(session.tenant.id, (tx) => listPlugins(tx, siteId));
  const canManage = session.role !== "editor";
  return (
    <>
      <PageHeader
        title="Plugins"
        description="Connect outside services to your stores' cart and checkout. Each plugin is an https address we call, signed with its own secret, at the moments it chooses. A plugin that is slow or down is skipped — it can shape a sale but never stop your store from selling."
      />
      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          {plugins.length === 0 && (
            <Card>
              <EmptyState icon="plug" title="No plugins connected" body="Connect one with the form, or share the contract below with a developer." />
            </Card>
          )}
          {plugins.map((p) => (
            <Card key={p.id}>
              <CardHeader
                title={<span className="flex items-center gap-2">{p.name} {p.active ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</span>}
                description={
                  <>
                    <code className="break-all font-mono text-xs">{p.url}</code>
                    <br />
                    {p.last_called_at ? `Last called ${ago(p.last_called_at)}` : "Not called yet"}
                  </>
                }
              />
              {p.last_error && <p className="mx-5 mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">Last problem: {p.last_error}</p>}
              {canManage && (
                <>
                  <ActionForm action={updatePluginAction} className="grid gap-4 border-t border-slate-100 p-5">
                    <input type="hidden" name="id" value={p.id} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input name="name" defaultValue={p.name} className="field" aria-label="Name" />
                      <input name="url" defaultValue={p.url} className="field font-mono text-xs" aria-label="Address" />
                    </div>
                    <HookBoxes selected={p.hooks} />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="active" value="1" defaultChecked={p.active} /> On
                    </label>
                    <SubmitButton pending="Saving…" variant="secondary">Save</SubmitButton>
                  </ActionForm>
                  <div className="flex flex-wrap gap-2 border-t border-slate-100 p-5">
                    <ActionForm action={rotateSecretAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <SubmitButton variant="secondary" size="sm" confirm="Make a new signing secret? The plugin must be given it before it can check our calls again.">
                        New signing secret
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={deletePluginAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <SubmitButton variant="danger" size="sm" confirm={`Disconnect ${p.name}?`}>Disconnect</SubmitButton>
                    </ActionForm>
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
        <div className="space-y-6">
          {canManage && (
            <Card>
              <CardHeader title="Connect a plugin" />
              <ActionForm action={createPluginAction} className="space-y-4 p-5" resetOnOk>
                <div>
                  <label className="label" htmlFor="pname">Name</label>
                  <input id="pname" name="name" required className="field" placeholder="Loyalty points" />
                </div>
                <div>
                  <label className="label" htmlFor="purl">Address</label>
                  <input id="purl" name="url" required className="field font-mono text-xs" placeholder="https://plugin.example.com/zuuvy" />
                </div>
                <HookBoxes selected={[]} />
                <SubmitButton pending="Connecting…">Connect</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Card>
            <CardHeader title="For developers: the contract" />
            <div className="space-y-3 p-5 text-sm text-slate-700">
              <p>
                Each call is a <code>POST</code> of JSON with <code>hook</code> naming the moment. It carries{" "}
                <code>X-Zuuvy-Hook</code> and <code>X-Zuuvy-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code>, where v1 is HMAC-SHA256 of{" "}
                <code>&quot;t.body&quot;</code> with your secret. Answer within 3 seconds with at most 64 KB of JSON.
              </p>
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{`cart.calculate    → { "adjustments": [{ "label": "Gift wrap", "amount": 49 }],
                      "messages": [{ "text": "You earn 12 points", "tone": "success" }] }
                    amount in ₹; negative is money off. At most 5 of each.
checkout.fields   → { "fields": [{ "name": "gstin", "label": "GSTIN", "type": "text",
                      "required": false, "options": [], "help": null }] }
                    type: text | textarea | select | checkbox | date. At most 6.
checkout.validate → { "ok": true }  or  { "ok": false, "error": "We do not deliver there." }
order.placed      → anything (retried until you answer 2xx)`}</pre>
              <p>Answers to your checkout fields are stored on the order and sent to you with <code>order.placed</code>.</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
