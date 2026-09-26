import { CONNECTORS } from "@zsite/connectors";
import { listIntegrations, withTenant } from "@zsite/platform";
import Link from "next/link";
import { Badge, Card, Icon, PageHeader, cx } from "@/components/ui";
import { ago } from "@/lib/format";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Integrations" };

const CATEGORY = { commerce: "Commerce", payments: "Payments", messaging: "Messaging", data: "Data sources" } as const;

export default async function IntegrationsPage() {
  const session = await requireSession();
  const integrations = await withTenant(session.tenant.id, listIntegrations);
  const byKind = new Map(integrations.map((i) => [i.kind, i]));

  return (
    <>
      <PageHeader title="Integrations" description="Connect the systems your business already runs on. Each one works on its own; disconnecting never deletes your site." />
      {(Object.keys(CATEGORY) as (keyof typeof CATEGORY)[]).map((cat) => {
        const items = CONNECTORS.filter((c) => c.category === cat);
        if (!items.length) return null;
        return (
          <section key={cat} className="mb-8">
            <h2 className="mb-3 text-sm font-semibold text-slate-500">{CATEGORY[cat]}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((c) => {
                const row = byKind.get(c.kind);
                const connected = row && row.status !== "disconnected";
                const soon = c.availability !== "available";
                const body = (
                  <Card className={cx("flex h-full flex-col p-5 transition", !soon && "hover:border-brand-300 hover:shadow-sm", soon && "opacity-70")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-lg bg-slate-900 text-sm font-bold text-white">{c.name.slice(0, 1)}</div>
                      {soon ? (
                        <Badge>Coming soon</Badge>
                      ) : connected ? (
                        <Badge tone={row.status === "connected" ? "green" : "red"}>{row.status === "connected" ? "Connected" : "Needs attention"}</Badge>
                      ) : (
                        <Badge tone="brand">Available</Badge>
                      )}
                    </div>
                    <p className="mt-4 font-semibold text-slate-900">{c.name}</p>
                    <p className="mt-1 flex-1 text-sm text-slate-500">{c.tagline}</p>
                    {connected && (
                      <p className="mt-4 text-xs text-slate-500">
                        {row.config.info?.headline} · synced {ago(row.last_sync_at)}
                      </p>
                    )}
                    {!soon && !connected && (
                      <p className="mt-4 flex items-center gap-1 text-sm font-medium text-brand-600">
                        Connect <Icon name="arrowOut" className="h-3.5 w-3.5" />
                      </p>
                    )}
                  </Card>
                );
                return soon ? (
                  <div key={c.kind}>{body}</div>
                ) : (
                  <Link key={c.kind} href={`/integrations/${c.kind}`}>{body}</Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
