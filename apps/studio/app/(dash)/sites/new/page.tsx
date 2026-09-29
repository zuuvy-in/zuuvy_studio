import { TEMPLATES } from "@zsite/core";
import { config, parseLanding } from "@zsite/platform";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { ImportSiteForm, NewSiteForm } from "./form";

export const metadata = { title: "New site" };

const TEMPLATE_FOR = { landing: "landing-launch", portfolio: "portfolio-studio", store: "store-classic" } as const;

export default async function NewSitePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const q = await searchParams;
  const p = parseLanding((k) => (typeof q[k] === "string" ? q[k] : null));
  const templates = TEMPLATES.map(({ id, name, kind, description }) => ({ id, name, kind, description }));
  return (
    <>
      <PageHeader eyebrow="Sites" title="Create a site" description="Start from a template. After that, describe changes in plain words and the AI makes them." />
      <NewSiteForm templates={templates} businessName={session.tenant.name} domain={config.platformDomain()}
        initial={{
          template: p.kind ? TEMPLATE_FOR[p.kind] : undefined,
          name: p.site,
          subdomain: p.subdomain,
          tagline: p.tagline,
          prompt: p.prompt,
        }}
      />
      <Card className="mt-10">
        <CardHeader title="Or import an exported site" description="Moving a site between businesses, or bringing back one you exported before deleting it." />
        <ImportSiteForm domain={config.platformDomain()} />
      </Card>
    </>
  );
}
