import { TEMPLATES } from "@zsite/core";
import { config } from "@zsite/platform";
import { PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { NewSiteForm } from "./form";

export const metadata = { title: "New site" };

export default async function NewSitePage() {
  const session = await requireSession();
  const templates = TEMPLATES.map(({ id, name, kind, description }) => ({ id, name, kind, description }));
  return (
    <>
      <PageHeader eyebrow="Sites" title="Create a site" description="Start from a template. After that, describe changes in plain words and the AI makes them." />
      <NewSiteForm templates={templates} businessName={session.tenant.name} domain={config.platformDomain()} />
    </>
  );
}
