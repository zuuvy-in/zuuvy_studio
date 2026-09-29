import { NotFound, getSite, isUuid, latestVersion, withTenant } from "@zsite/platform";
import { notFound } from "next/navigation";
import { Tabs } from "@/components/nav";
import { Badge, ButtonLink, Icon } from "@/components/ui";
import { requireSession } from "@/lib/session";

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const session = await requireSession();
  if (!isUuid(siteId)) notFound();
  const { site, usesCollections } = await withTenant(session.tenant.id, async (tx) => {
    const site = await getSite(tx, siteId);
    const tree = (await latestVersion(tx, siteId)).tree;
    return { site, usesCollections: Boolean(tree?.pages.some((p) => p.sections.some((s) => s.type === "collection"))) };
  }).catch((e) => {
    if (e instanceof NotFound) notFound();
    throw e;
  });
  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-slate-500">Sites</p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{site.name}</h1>
            {site.published_number ? <Badge tone="green">Live · v{site.published_number}</Badge> : <Badge>Not published</Badge>}
            {site.latest_number !== site.published_number && <Badge tone="amber">Latest v{site.latest_number} not live</Badge>}
          </div>
        </div>
        <ButtonLink href={site.url} external variant="secondary">
          {site.url.replace(/^https?:\/\//, "")} <Icon name="external" />
        </ButtonLink>
      </div>
      <Tabs
        tabs={[
          { href: `/sites/${site.id}/versions`, label: "Versions" },
          // Portfolio content is for portfolios (and a site that still shows it after a type change).
          ...(site.kind === "portfolio" || usesCollections ? [{ href: `/sites/${site.id}/content`, label: "Portfolio content" }] : []),
          { href: `/sites/${site.id}/forms`, label: "Forms" },
          { href: `/sites/${site.id}/settings`, label: "Settings" },
        ]}
      />
      {children}
    </>
  );
}
