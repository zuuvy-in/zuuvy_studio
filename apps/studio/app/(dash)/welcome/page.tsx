import { getAlerts, withTenant } from "@zsite/platform";
import Link from "next/link";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { AlertsForm } from "../settings/alerts-form";

export const metadata = { title: "Welcome" };

/** The first stop after signing up: who hears about new orders. */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await requireSession();
  const raw = (await searchParams).next;
  // Only somewhere inside the studio; a link someone crafted cannot send a new customer elsewhere.
  const next = typeof raw === "string" && raw.startsWith("/sites/") && !raw.startsWith("//") ? raw : "/sites/new";
  const alerts = await withTenant(session.tenant.id, getAlerts);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={`Welcome, ${session.user.name.split(" ")[0]}`} description="One thing before your first site: who should hear about new orders? We've emailed you a link to confirm your address — your site goes live once it is confirmed." />
      <Card>
        <CardHeader title="New-order alerts" description="You can change this any time under Settings." />
        <AlertsForm alerts={alerts} next={next} submit={next === "/sites/new" ? "Save and create my site" : "Save and build my site"} />
      </Card>
      <p className="mt-4 text-center text-sm"><Link href={next} className="text-slate-500 hover:text-slate-800">Skip for now →</Link></p>
    </div>
  );
}
