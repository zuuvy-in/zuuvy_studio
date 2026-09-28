import { estimateUsd, usageByPerson, usageSummary, withTenant } from "@zsite/platform";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { compact, usd } from "@/lib/format";
import { requireSession } from "@/lib/session";

export const metadata = { title: "AI usage" };

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

export default async function UsagePage() {
  const session = await requireSession();
  const { summary, people } = await withTenant(session.tenant.id, async (tx) => ({
    summary: await usageSummary(tx, session.user.id),
    people: await usageByPerson(tx),
  }));
  const month = summary.since.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const m = summary.mine;
  const b = summary.business;
  return (
    <>
      <PageHeader title="AI usage" description={`Tokens the AI used on your edits in ${month}. Every attempt counts — including ones that saved no version.`} />
      <h2 className="mb-3 text-sm font-semibold text-slate-900">You</h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tokens" value={compact(m.input_tokens + m.output_tokens)} hint={`${compact(m.input_tokens)} in · ${compact(m.output_tokens)} out`} />
        <Stat label="AI edits" value={String(m.attempts)} hint={`${m.versions} saved as versions`} />
        <Stat label="Pictures made" value={String(m.images)} />
        <Stat label="Approx. cost" value={usd(estimateUsd(m.input_tokens, m.output_tokens))} hint="At list price; for a sense of scale" />
      </div>
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{session.tenant.name}</h2>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tokens" value={compact(b.input_tokens + b.output_tokens)} />
        <Stat label="AI edits" value={String(b.attempts)} hint={`${b.versions} saved as versions`} />
        <Stat label="Pictures made" value={String(b.images)} />
        <Stat label="Approx. cost" value={usd(estimateUsd(b.input_tokens, b.output_tokens))} />
      </div>
      <Card>
        <CardHeader title="By person" description={month} />
        {people.length === 0 ? (
          <EmptyState title="No AI edits yet this month" body="Describe a change on any site's Versions page." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Person</th>
                <th className="px-3 py-3 text-right font-medium">Edits</th>
                <th className="px-3 py-3 text-right font-medium">Versions</th>
                <th className="px-3 py-3 text-right font-medium">Tokens in</th>
                <th className="px-3 py-3 text-right font-medium">Tokens out</th>
                <th className="px-5 py-3 text-right font-medium">Pictures</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {people.map((p) => (
                <tr key={p.user_id ?? "gone"}>
                  <td className="px-5 py-3"><p className="font-medium text-slate-900">{p.name ?? "Removed user"}</p><p className="text-xs text-slate-500">{p.email}</p></td>
                  <td className="px-3 py-3 text-right">{p.attempts}</td>
                  <td className="px-3 py-3 text-right">{p.versions}</td>
                  <td className="px-3 py-3 text-right">{compact(p.input_tokens)}</td>
                  <td className="px-3 py-3 text-right">{compact(p.output_tokens)}</td>
                  <td className="px-5 py-3 text-right">{p.images}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
