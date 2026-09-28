import { adminUser, adminUserAttempts, adminUserVersions, estimateUsd, isUuid } from "@zsite/platform";
import { notFound } from "next/navigation";
import { SourceBadge } from "@/components/badges";
import { Badge, Card, CardHeader, Dl, EmptyState, PageHeader } from "@/components/ui";
import { ago, compact, dateTime, usd } from "@/lib/format";
import { requirePlatformAdmin } from "@/lib/session";

export default async function AdminUserPage({ params }: { params: Promise<{ userId: string }> }) {
  await requirePlatformAdmin();
  const { userId } = await params;
  if (!isUuid(userId)) notFound();
  const user = await adminUser(userId);
  if (!user) notFound();
  const [versions, attempts] = await Promise.all([adminUserVersions(userId), adminUserAttempts(userId)]);
  return (
    <>
      <PageHeader eyebrow="Platform admin" title={user.name} description={user.email} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Card className="overflow-x-auto">
            <CardHeader title={`Versions made (${versions.length})`} description="Across every business and site, newest first." />
            {versions.length === 0 ? (
              <EmptyState title="No versions yet" />
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Version</th>
                    <th className="px-3 py-3 font-medium">Change</th>
                    <th className="px-3 py-3 text-right font-medium">Tokens</th>
                    <th className="px-5 py-3 font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {versions.map((v) => (
                    <tr key={v.version_id}>
                      <td className="px-5 py-3 align-top">
                        <p className="font-medium text-slate-900">{v.site_name} · v{v.number}</p>
                        <p className="text-xs text-slate-500">{v.business} · {v.subdomain}</p>
                        <div className="mt-1 flex gap-1"><SourceBadge source={v.source as "ai"} />{v.published && <Badge tone="green">Live</Badge>}</div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <p className="text-slate-800">{v.summary}</p>
                        {v.prompt && <p className="mt-1 line-clamp-3 text-xs text-slate-500">“{v.prompt}”</p>}
                      </td>
                      <td className="px-3 py-3 text-right align-top tabular-nums">{v.input_tokens + v.output_tokens ? compact(v.input_tokens + v.output_tokens) : "—"}</td>
                      <td className="px-5 py-3 align-top text-xs text-slate-500">{dateTime(v.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card className="overflow-x-auto">
            <CardHeader title="AI attempts" description="Every request, including the ones that failed or changed nothing." />
            {attempts.length === 0 ? (
              <EmptyState title="No AI edits yet" />
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {attempts.map((a, i) => (
                    <tr key={i}>
                      <td className="px-5 py-3">
                        <Badge tone={a.outcome === "version" ? "green" : a.outcome === "error" ? "red" : "amber"}>{a.outcome.replace("_", " ")}</Badge>
                        <span className="ml-2 text-slate-700">{a.business}{a.site_name ? ` · ${a.site_name}` : ""}</span>
                        {a.error && <p className="mt-1 text-xs text-rose-700">{a.error}</p>}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{compact(a.input_tokens)} in · {compact(a.output_tokens)} out{a.images ? ` · ${a.images} pics` : ""}</td>
                      <td className="px-5 py-3 text-xs text-slate-500">{ago(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
        <aside className="space-y-6">
          <Card>
            <CardHeader title="Summary" />
            <Dl
              items={[
                ["Businesses", user.businesses.join(", ") || "—"],
                ["Joined", dateTime(user.created_at)],
                ["Last seen", ago(user.last_seen)],
                ["Sites", String(user.sites)],
                ["Versions", `${user.versions} (${user.ai_versions} by AI)`],
                ["AI edits", String(user.ai_attempts)],
                ["Tokens this month", compact(user.period_input_tokens + user.period_output_tokens)],
                ["Tokens all time", `${compact(user.input_tokens)} in · ${compact(user.output_tokens)} out`],
                ["Pictures made", String(user.images)],
                ["Approx. cost, all time", usd(estimateUsd(user.input_tokens, user.output_tokens))],
              ]}
            />
          </Card>
        </aside>
      </div>
    </>
  );
}
