import { CONNECTORS } from "@zsite/connectors";
import { getIntegration, listEvents, webhookUrl, withTenant } from "@zsite/platform";
import { notFound } from "next/navigation";
import { ActionForm, CopyField, SubmitButton } from "@/components/forms";
import { Badge, Card, CardHeader, Dl, EmptyState, Icon, PageHeader } from "@/components/ui";
import { ago, dateTime } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { connectAction, disconnectAction, rotateAction, syncAction, testAction } from "../actions";

const CAPABILITY: Record<string, string> = {
  catalog: "Brings in products marked for online sale, with prices and stock",
  orders: "Sends every order placed on your store",
  order_updates: "Updates orders as they are accepted, packed and delivered",
  messaging: "Sends messages",
  payments: "Takes payments",
};

export default async function IntegrationPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const connector = CONNECTORS.find((c) => c.kind === kind);
  if (!connector || connector.availability !== "available") notFound();
  const session = await requireSession();
  const { row, events } = await withTenant(session.tenant.id, async (tx) => {
    const row = await getIntegration(tx, kind);
    return { row, events: row ? await listEvents(tx, row.id, 60) : [] };
  });
  const connected = row && row.status !== "disconnected";
  const canManage = session.role !== "editor";

  return (
    <>
      <PageHeader
        eyebrow="Integrations"
        title={
          <span className="flex items-center gap-3">
            {connector.name}
            {connected ? (
              <Badge tone={row.status === "connected" ? "green" : "red"}>{row.status === "connected" ? "Connected" : "Needs attention"}</Badge>
            ) : (
              <Badge>Not connected</Badge>
            )}
          </span>
        }
        description={connector.description}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {connected ? (
            <>
              <Card>
                <CardHeader
                  title={row.config.info?.headline ?? "Connection"}
                  description={`Connected ${ago(row.created_at)} · last catalogue sync ${ago(row.last_sync_at)}`}
                />
                {row.last_error && (
                  <div className="border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-800">{row.last_error}</div>
                )}
                {row.config.info && <Dl items={Object.entries(row.config.info.details)} />}
                <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-4">
                  <ActionForm action={syncAction}>
                    <input type="hidden" name="kind" value={kind} />
                    <SubmitButton size="sm" pending="Syncing…"><Icon name="refresh" /> Sync changes</SubmitButton>
                  </ActionForm>
                  <ActionForm action={syncAction}>
                    <input type="hidden" name="kind" value={kind} />
                    <input type="hidden" name="full" value="1" />
                    <SubmitButton size="sm" variant="secondary" pending="Syncing…">Full resync</SubmitButton>
                  </ActionForm>
                  <ActionForm action={testAction}>
                    <input type="hidden" name="kind" value={kind} />
                    <SubmitButton size="sm" variant="secondary" pending="Testing…">Test connection</SubmitButton>
                  </ActionForm>
                </div>
              </Card>

              <Card>
                <CardHeader title="Activity" description="Everything exchanged with Zuuvy, newest first. Kept permanently." />
                {events.length === 0 ? (
                  <EmptyState icon="history" title="Nothing yet" />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {events.map((e) => (
                      <li key={e.id} className="px-5 py-3">
                        <details className="group">
                          <summary className="flex cursor-pointer list-none items-center gap-3 text-sm">
                            <span className={e.direction === "in" ? "text-sky-600" : "text-slate-400"} title={e.direction === "in" ? "From Zuuvy" : "To Zuuvy"}>
                              <Icon name={e.direction === "in" ? "arrowIn" : "arrowOut"} />
                            </span>
                            <code className="w-40 shrink-0 truncate text-xs text-slate-500">{e.topic}</code>
                            <span className="min-w-0 flex-1 truncate text-slate-800">{e.summary}</span>
                            <Badge tone={e.status === "ok" ? "green" : e.status === "error" ? "red" : "gray"}>{e.status}</Badge>
                            <time className="hidden w-24 shrink-0 text-right text-xs text-slate-500 sm:block" title={dateTime(e.created_at)}>{ago(e.created_at)}</time>
                          </summary>
                          {e.payload !== null && (
                            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(e.payload, null, 2)}</pre>
                          )}
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          ) : (
            <Card>
              <CardHeader title={`Connect ${connector.name}`} description="Your credentials are encrypted before they are stored." />
              {canManage ? (
                <ActionForm action={connectAction} className="space-y-4 p-5">
                  <input type="hidden" name="kind" value={kind} />
                  {connector.fields.map((f) => (
                    <div key={f.name}>
                      <label className="label" htmlFor={f.name}>
                        {f.label} {!f.required && <span className="font-normal text-slate-400">(optional)</span>}
                      </label>
                      <input
                        id={f.name}
                        name={f.name}
                        type={f.kind === "secret" ? "password" : f.kind === "url" ? "url" : "text"}
                        required={f.required}
                        placeholder={f.placeholder}
                        autoComplete="off"
                        defaultValue={f.name === "tenant" && row ? String(row.config.tenant ?? "") : undefined}
                        className="field"
                      />
                      {f.help && <p className="help">{f.help}</p>}
                    </div>
                  ))}
                  <SubmitButton pending="Connecting…">Connect</SubmitButton>
                </ActionForm>
              ) : (
                <p className="p-5 text-sm text-slate-600">Ask an owner or admin to connect {connector.name}.</p>
              )}
            </Card>
          )}
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="What it does" />
            <ul className="space-y-2.5 px-5 py-4 text-sm">
              {connector.capabilities.map((c) => (
                <li key={c} className="flex gap-2">
                  <Icon name="check" className="mt-0.5 text-emerald-600" />
                  <span className="text-slate-700">{CAPABILITY[c]}</span>
                </li>
              ))}
            </ul>
            <p className="border-t border-slate-100 px-5 py-4 text-xs text-slate-500">
              Stock is reserved in Zuuvy when an order is confirmed: straight away for an order paid online, and when your team accepts it for cash on delivery.
            </p>
          </Card>

          {connected && (
            <Card>
              <CardHeader title="Webhook" description="Registered with Zuuvy automatically when you connected." />
              <div className="space-y-4 p-5">
                <CopyField value={webhookUrl(row.id)} label="Address" />
                {canManage && (
                  <ActionForm action={rotateAction}>
                    <input type="hidden" name="kind" value={kind} />
                    <SubmitButton size="sm" variant="secondary" pending="Rotating…" confirm="Replace the signing secret? Zuuvy is told the new one at once.">
                      Rotate signing secret
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
            </Card>
          )}

          {connected && canManage && (
            <Card>
              <CardHeader title="Disconnect" />
              <div className="p-5">
                <p className="mb-4 text-sm text-slate-600">Forgets the credentials and hides {connector.name} products from your store. Orders already placed stay.</p>
                <ActionForm action={disconnectAction}>
                  <input type="hidden" name="kind" value={kind} />
                  <SubmitButton size="sm" variant="danger" pending="Disconnecting…" confirm={`Disconnect ${connector.name}?`}>
                    Disconnect {connector.name}
                  </SubmitButton>
                </ActionForm>
              </div>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
