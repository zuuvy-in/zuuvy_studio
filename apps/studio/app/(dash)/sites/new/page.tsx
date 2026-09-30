import { TEMPLATES } from "@zsite/core";
import { config, listShowcases, parseLanding } from "@zsite/platform";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { ImportSiteForm, NewSiteForm } from "./form";
import { ShowcaseGallery } from "./gallery";

export const metadata = { title: "New site" };

const TEMPLATE_FOR = { landing: "landing-launch", portfolio: "portfolio-studio", store: "store-classic" } as const;

export default async function NewSitePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const q = await searchParams;
  const p = parseLanding((k) => (typeof q[k] === "string" ? q[k] : null));
  const showcases = (await listShowcases()).filter((s) => !p.kind || s.kind === p.kind);
  const templates = TEMPLATES.map(({ id, name, kind, description }) => ({ id, name, kind, description }));
  return (
    <>
      <PageHeader eyebrow="Sites" title="Create a site" description="Start from a template. After that, describe changes in plain words and the AI makes them." />
      {showcases.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-1 text-base font-semibold text-slate-900">Start from a finished site</h2>
          <p className="mb-4 text-sm text-slate-600">Designed for your kind of business. Preview it live, then make a copy that is yours to change.</p>
          <ShowcaseGallery
            items={showcases.map((s) => ({ id: s.id, title: s.title, category: s.category, description: s.description, cover: s.cover_url, url: s.url, kind: s.kind }))}
            businessName={session.tenant.name}
            domain={config.platformDomain()}
          />
          <h2 className="mt-10 mb-1 text-base font-semibold text-slate-900">Or start simple</h2>
          <p className="mb-4 text-sm text-slate-600">A basic layout the AI shapes around what you tell it.</p>
        </section>
      )}
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
