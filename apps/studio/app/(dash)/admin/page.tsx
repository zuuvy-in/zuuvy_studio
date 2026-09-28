import { adminTotals, adminUsers, estimateUsd } from "@zsite/platform";
import Link from "next/link";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { ago, compact, usd } from "@/lib/format";
import { requirePlatformAdmin } from "@/lib/session";
import { AdminTabs } from "./nav";

export const metadata = { title: "Platform admin" };

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePlatformAdmin();
  const { q } = await searchParams;
  const [totals, users] = await Promise.all([adminTotals(), adminUsers()]);
  const needle = q?.trim().toLowerCase();
  const shown = needle
    ? users.filter((u) => u.email.toLowerCase().includes(needle) || u.name.toLowerCase().includes(needle) || u.businesses.some((b) => b.toLowerCase().includes(needle)))
    : users;
  const periodTokens = totals.period_input_tokens + totals.period_output_tokens;
  return (
    <>
      <PageHeader eyebrow="Zuuvy Sites" title="Platform admin" description="Everyone on the platform, what the AI has cost, and the versions they have made. Internal only." />
      <AdminTabs />
      <div className="mb-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="People" value={String(totals.users)} hint={`${totals.businesses} businesses`} />
        <Stat label="Sites" value={String(totals.sites)} hint={`${totals.published_sites} published`} />
        <Stat label="Versions" value={compact(totals.versions)} />
        <Stat label="Tokens this month" value={compact(periodTokens)} hint={`${totals.period_attempts} AI edits`} />
        <Stat label="Cost this month" value={usd(estimateUsd(totals.period_input_tokens, totals.period_output_tokens))} hint="Approx., list price" />
        <Stat label="Custom domains" value={String(totals.domains)} hint={`${totals.active_domains} active`} />
      </div>
      <Card className="overflow-x-auto">
        <CardHeader
          title={`People (${shown.length})`}
          description="Sorted by tokens used this month."
          actions={
            <form className="flex gap-2">
              <input name="q" defaultValue={q} placeholder="Search name, email, business" className="field w-56 py-1.5 text-sm" />
            </form>
          }
        />
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Person</th>
              <th className="px-3 py-3 font-medium">Businesses</th>
              <th className="px-3 py-3 text-right font-medium">Sites</th>
              <th className="px-3 py-3 text-right font-medium">Versions</th>
              <th className="px-3 py-3 text-right font-medium">AI edits (month)</th>
              <th className="px-3 py-3 text-right font-medium">Tokens (month)</th>
              <th className="px-3 py-3 text-right font-medium">Tokens (all)</th>
              <th className="px-5 py-3 font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums">
            {shown.map((u) => (
              <tr key={u.user_id} className="hover:bg-slate-50">
                <td className="px-5 py-3">
                  <Link href={`/admin/users/${u.user_id}`} className="font-medium text-slate-900 hover:underline">{u.name}</Link>
                  <p className="text-xs text-slate-500">{u.email}</p>
                </td>
                <td className="px-3 py-3 text-slate-600">{u.businesses.join(", ") || "—"}</td>
                <td className="px-3 py-3 text-right">{u.sites}</td>
                <td className="px-3 py-3 text-right">{u.versions} {u.ai_versions > 0 && <Badge tone="violet">{u.ai_versions} AI</Badge>}</td>
                <td className="px-3 py-3 text-right">{u.period_attempts}</td>
                <td className="px-3 py-3 text-right font-medium">{compact(u.period_input_tokens + u.period_output_tokens)}</td>
                <td className="px-3 py-3 text-right text-slate-500">{compact(u.input_tokens + u.output_tokens)}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{ago(u.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
