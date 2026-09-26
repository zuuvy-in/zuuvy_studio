/**
 * Sites and their versions.
 *
 * Every change — a template, an AI prompt, a restore, an imported codebase —
 * is a new, immutable version. Publishing moves `sites.published_version_id`
 * and records it in `site_publications`; rolling back is publishing an older
 * version. Nothing is edited in place, so "what was live last Tuesday" always
 * has an answer.
 */
import {
  type Change,
  type SiteKind,
  type SiteTree,
  type TemplateInput,
  diffTrees,
  getTemplate,
  normaliseSubdomain,
  parseTree,
  subdomainProblem,
  summarise,
} from "@zsite/core";
import { siteUrl } from "./config";
import { NotFound, type Tx, UserError, isUniqueViolation } from "./db";

/** The runtime new sites render with. Runtimes deploy side by side. */
export const CURRENT_RUNTIME = "1";

export type Site = {
  id: string;
  name: string;
  kind: SiteKind;
  subdomain: string;
  runtime_version: string;
  published_version_id: string | null;
  created_at: Date;
  updated_at: Date;
  url: string;
  published_number: number | null;
  latest_number: number;
};

export type VersionSource = "template" | "ai" | "manual" | "restore" | "import";

export type VersionRow = {
  id: string;
  site_id: string;
  number: number;
  parent_id: string | null;
  parent_number: number | null;
  mode: "managed" | "code";
  runtime_version: string;
  source: VersionSource;
  prompt: string | null;
  summary: string;
  ai_meta: Record<string, unknown> | null;
  created_by_name: string | null;
  created_at: Date;
  is_published: boolean;
};

export type Version = VersionRow & { tree: SiteTree | null; git_ref: string | null };

const SITE_COLUMNS = `
  s.id, s.name, s.kind, s.subdomain, s.runtime_version, s.published_version_id, s.created_at, s.updated_at,
  pv.number as published_number, s.version_seq as latest_number`;

function withUrl<T extends { subdomain: string }>(row: T): T & { url: string } {
  return { ...row, url: siteUrl(row.subdomain) };
}

export async function listSites(tx: Tx): Promise<Site[]> {
  const rows = await tx.query<Omit<Site, "url">>(
    `select ${SITE_COLUMNS} from sites s left join site_versions pv on pv.id = s.published_version_id
      order by s.created_at`,
  );
  return rows.map(withUrl);
}

export async function getSite(tx: Tx, siteId: string): Promise<Site> {
  const row = await tx.get<Omit<Site, "url">>(
    `select ${SITE_COLUMNS} from sites s left join site_versions pv on pv.id = s.published_version_id
      where s.id = $1`,
    [siteId],
    "site",
  );
  return withUrl(row);
}

export async function checkSubdomain(tx: Tx, raw: string): Promise<{ subdomain: string; problem: string | null }> {
  const subdomain = normaliseSubdomain(raw);
  const problem = subdomainProblem(subdomain);
  if (problem) return { subdomain, problem };
  const taken = await tx.one<{ taken: boolean }>("select subdomain_taken($1) as taken", [subdomain]);
  return { subdomain, problem: taken?.taken ? "That address is taken." : null };
}

export type CreateSiteInput = {
  name: string;
  subdomain: string;
  templateId: string;
  templateInput: TemplateInput;
  userId: string | null;
};

/** Create a site from a template; version 1 is published straight away. */
export async function createSite(tx: Tx, input: CreateSiteInput): Promise<Site> {
  const name = input.name.trim();
  if (!name) throw new UserError("Give the site a name.");
  const { subdomain, problem } = await checkSubdomain(tx, input.subdomain);
  if (problem) throw new UserError(problem);
  const template = getTemplate(input.templateId);
  const tree = template.build(input.templateInput);

  let siteId: string;
  try {
    await tx.query("savepoint create_site");
    const row = await tx.get<{ id: string }>(
      `insert into sites (tenant_id, name, kind, subdomain, runtime_version)
       values (app_tenant(), $1, $2, $3, $4) returning id`,
      [name, template.kind, subdomain, CURRENT_RUNTIME],
    );
    await tx.query("release savepoint create_site");
    siteId = row.id;
  } catch (e) {
    await tx.query("rollback to savepoint create_site");
    if (isUniqueViolation(e)) throw new UserError("That address is taken.");
    throw e;
  }
  const v = await createVersion(tx, siteId, {
    tree,
    parentId: null,
    source: "template",
    summary: `Created from the ${template.name} template`,
    userId: input.userId,
  });
  await publishVersion(tx, siteId, v.id, input.userId);
  return getSite(tx, siteId);
}

export type NewVersion = {
  tree: SiteTree;
  parentId: string | null;
  source: VersionSource;
  prompt?: string | null;
  summary?: string;
  aiMeta?: Record<string, unknown> | null;
  userId: string | null;
};

export async function createVersion(tx: Tx, siteId: string, v: NewVersion): Promise<{ id: string; number: number }> {
  const tree = parseTree(v.tree);
  const site = await tx.get<{ runtime_version: string }>(
    "select runtime_version from sites where id = $1 for update",
    [siteId],
    "site",
  );
  let summary = v.summary;
  if (summary === undefined) {
    const parent = v.parentId ? await getVersion(tx, siteId, v.parentId) : null;
    summary = parent?.tree ? summarise(diffTrees(parent.tree, tree)) : "First version";
  }
  const seq = await tx.get<{ n: number }>(
    "update sites set version_seq = version_seq + 1, updated_at = now() where id = $1 returning version_seq as n",
    [siteId],
  );
  return tx.get<{ id: string; number: number }>(
    `insert into site_versions
       (tenant_id, site_id, number, parent_id, mode, tree, runtime_version, source, prompt, summary, ai_meta, created_by)
     values (app_tenant(), $1, $2, $3, 'managed', $4, $5, $6, $7, $8, $9, $10)
     returning id, number`,
    [siteId, seq.n, v.parentId, JSON.stringify(tree), site.runtime_version, v.source, v.prompt ?? null, summary,
      v.aiMeta ? JSON.stringify(v.aiMeta) : null, v.userId],
  );
}

const VERSION_COLUMNS = `
  v.id, v.site_id, v.number, v.parent_id, p.number as parent_number, v.mode, v.runtime_version, v.source,
  v.prompt, v.summary, v.ai_meta, u.name as created_by_name, v.created_at,
  (s.published_version_id = v.id) as is_published`;

const VERSION_FROM = `
  from site_versions v
  join sites s on s.id = v.site_id
  left join site_versions p on p.id = v.parent_id
  left join users u on u.id = v.created_by`;

export async function listVersions(tx: Tx, siteId: string, limit = 100): Promise<VersionRow[]> {
  return tx.query<VersionRow>(
    `select ${VERSION_COLUMNS} ${VERSION_FROM} where v.site_id = $1 order by v.number desc limit $2`,
    [siteId, limit],
  );
}

export async function getVersion(tx: Tx, siteId: string, versionId: string): Promise<Version> {
  return tx.get<Version>(
    `select ${VERSION_COLUMNS}, v.tree, v.git_ref ${VERSION_FROM} where v.site_id = $1 and v.id = $2`,
    [siteId, versionId],
    "version",
  );
}

export async function getVersionByNumber(tx: Tx, siteId: string, number: number): Promise<Version> {
  return tx.get<Version>(
    `select ${VERSION_COLUMNS}, v.tree, v.git_ref ${VERSION_FROM} where v.site_id = $1 and v.number = $2`,
    [siteId, number],
    "version",
  );
}

export async function latestVersion(tx: Tx, siteId: string): Promise<Version> {
  return tx.get<Version>(
    `select ${VERSION_COLUMNS}, v.tree, v.git_ref ${VERSION_FROM} where v.site_id = $1 order by v.number desc limit 1`,
    [siteId],
    "version",
  );
}

export async function publishedVersion(tx: Tx, siteId: string): Promise<Version | null> {
  const site = await tx.get<{ published_version_id: string | null }>(
    "select published_version_id from sites where id = $1",
    [siteId],
    "site",
  );
  return site.published_version_id ? getVersion(tx, siteId, site.published_version_id) : null;
}

/** Publish (or roll back to) a version. Publishing the live version is a no-op. */
export async function publishVersion(tx: Tx, siteId: string, versionId: string, userId: string | null): Promise<void> {
  const site = await tx.get<{ published_version_id: string | null }>(
    "select published_version_id from sites where id = $1 for update",
    [siteId],
    "site",
  );
  const version = await tx.one<{ id: string; mode: string }>(
    "select id, mode from site_versions where id = $1 and site_id = $2",
    [versionId, siteId],
  );
  if (!version) throw new NotFound("version not found");
  if (site.published_version_id === versionId) return;
  await tx.query("update sites set published_version_id = $1, updated_at = now() where id = $2", [versionId, siteId]);
  await tx.query(
    `insert into site_publications (tenant_id, site_id, version_id, previous_version_id, published_by)
     values (app_tenant(), $1, $2, $3, $4)`,
    [siteId, versionId, site.published_version_id, userId],
  );
}

/** Bring an old version back as the newest one, so work continues from it. */
export async function restoreVersion(
  tx: Tx,
  siteId: string,
  versionId: string,
  userId: string | null,
): Promise<{ id: string; number: number }> {
  const old = await getVersion(tx, siteId, versionId);
  if (!old.tree) throw new UserError("Only managed versions can be restored this way.");
  const head = await latestVersion(tx, siteId);
  if (head.id === old.id) throw new UserError(`Version ${old.number} is already the latest.`);
  return createVersion(tx, siteId, {
    tree: old.tree,
    parentId: head.id,
    source: "restore",
    summary: `Restored version ${old.number}`,
    userId,
  });
}

export type Publication = {
  id: string;
  version_number: number;
  previous_number: number | null;
  published_by_name: string | null;
  published_at: Date;
};

export async function listPublications(tx: Tx, siteId: string, limit = 20): Promise<Publication[]> {
  return tx.query<Publication>(
    `select sp.id, v.number as version_number, pv.number as previous_number, u.name as published_by_name, sp.published_at
       from site_publications sp
       join site_versions v on v.id = sp.version_id
       left join site_versions pv on pv.id = sp.previous_version_id
       left join users u on u.id = sp.published_by
      where sp.site_id = $1
      order by sp.published_at desc limit $2`,
    [siteId, limit],
  );
}

export async function compareVersions(
  tx: Tx,
  siteId: string,
  fromId: string,
  toId: string,
): Promise<{ from: Version; to: Version; changes: Change[] }> {
  const [from, to] = await Promise.all([getVersion(tx, siteId, fromId), getVersion(tx, siteId, toId)]);
  const changes = from.tree && to.tree ? diffTrees(from.tree, to.tree) : [];
  return { from, to, changes };
}

export async function renameSite(tx: Tx, siteId: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new UserError("Give the site a name.");
  await tx.get("update sites set name = $1, updated_at = now() where id = $2 returning id", [clean, siteId], "site");
}
