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
  type Brand,
  type Change,
  type DataChange,
  type DataOp,
  type SiteData,
  applyDataOps,
  diffData,
  parseData,
  summariseData,
  type SiteKind,
  type SiteTree,
  type TemplateInput,
  aiChosenColors,
  applyBrand,
  diffTrees,
  getTemplate,
  parseBrand,
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
  brand: Brand;
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

export type Version = VersionRow & { tree: SiteTree | null; git_ref: string | null; data: SiteData };

const SITE_COLUMNS = `
  s.id, s.name, s.kind, s.subdomain, s.runtime_version, s.published_version_id, s.created_at, s.updated_at,
  pv.number as published_number, s.version_seq as latest_number, s.brand`;

function withUrl<T extends { subdomain: string; brand: unknown }>(row: T): T & { url: string; brand: Brand } {
  return { ...row, url: siteUrl(row.subdomain), brand: parseBrand(row.brand) };
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
  /** Anything the owner already knows about the brand; empty fields are the AI's to choose. */
  brand?: Brand;
};

/** Create a site from a template; version 1 is published straight away. */
export async function createSite(tx: Tx, input: CreateSiteInput): Promise<Site> {
  const name = input.name.trim();
  if (!name) throw new UserError("Give the site a name.");
  const { subdomain, problem } = await checkSubdomain(tx, input.subdomain);
  if (problem) throw new UserError(problem);
  const template = getTemplate(input.templateId);
  const brand = parseBrand(input.brand ?? {});
  const tree = applyBrand(template.build(input.templateInput), brand);
  const data = template.data?.(input.templateInput) ?? {};

  let siteId: string;
  try {
    await tx.query("savepoint create_site");
    const row = await tx.get<{ id: string }>(
      `insert into sites (tenant_id, name, kind, subdomain, runtime_version, brand)
       values (app_tenant(), $1, $2, $3, $4, $5) returning id`,
      [name, template.kind, subdomain, CURRENT_RUNTIME, JSON.stringify(brand)],
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
    data,
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
  /** The version's data collections; omitted = the parent's, unchanged. */
  data?: SiteData;
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
  const parent = v.parentId ? await getVersion(tx, siteId, v.parentId) : null;
  const data = parseData(v.data ?? parent?.data ?? {});
  let summary = v.summary;
  if (summary === undefined) {
    summary = parent?.tree
      ? [summarise(diffTrees(parent.tree, tree)), summariseData(diffData(parent.data, data))].filter(Boolean).join("; ") || "No changes"
      : "First version";
  }
  const seq = await tx.get<{ n: number }>(
    "update sites set version_seq = version_seq + 1, updated_at = now() where id = $1 returning version_seq as n",
    [siteId],
  );
  const created = await tx.get<{ id: string; number: number }>(
    `insert into site_versions
       (tenant_id, site_id, number, parent_id, mode, tree, data, runtime_version, source, prompt, summary, ai_meta, created_by)
     values (app_tenant(), $1, $2, $3, 'managed', $4, $11, $5, $6, $7, $8, $9, $10)
     returning id, number`,
    [siteId, seq.n, v.parentId, JSON.stringify(tree), site.runtime_version, v.source, v.prompt ?? null, summary,
      v.aiMeta ? JSON.stringify(v.aiMeta) : null, v.userId, JSON.stringify(data)],
  );
  await queueGit(tx, siteId, "git.push", created.id);
  return created;
}

/** With GitHub connected, every version becomes a branch; committed with the version itself. */
async function queueGit(tx: Tx, siteId: string, topic: "git.push" | "git.merge", versionId: string): Promise<void> {
  await tx.query(
    `insert into outbox (tenant_id, topic, payload)
     select app_tenant(), $2::text, jsonb_build_object('siteId', ($1::uuid)::text, 'versionId', ($3::uuid)::text)
      where exists (select 1 from site_git where site_id = $1::uuid and status in ('active', 'error'))`,
    [siteId, topic, versionId],
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
    `select ${VERSION_COLUMNS}, v.tree, v.git_ref, v.data ${VERSION_FROM} where v.site_id = $1 and v.id = $2`,
    [siteId, versionId],
    "version",
  );
}

export async function getVersionByNumber(tx: Tx, siteId: string, number: number): Promise<Version> {
  return tx.get<Version>(
    `select ${VERSION_COLUMNS}, v.tree, v.git_ref, v.data ${VERSION_FROM} where v.site_id = $1 and v.number = $2`,
    [siteId, number],
    "version",
  );
}

export async function latestVersion(tx: Tx, siteId: string): Promise<Version> {
  return tx.get<Version>(
    `select ${VERSION_COLUMNS}, v.tree, v.git_ref, v.data ${VERSION_FROM} where v.site_id = $1 order by v.number desc limit 1`,
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
  await queueGit(tx, siteId, "git.merge", versionId);
}

/**
 * Bring an old version back as the newest one, so work continues from it.
 *
 * The layout comes back whole. The data comes back table by table: each
 * collection named in `resetCollections` is reset to what it held in the old
 * version; every other collection keeps today's entries. Omitted means all.
 */
export async function restoreVersion(
  tx: Tx,
  siteId: string,
  versionId: string,
  userId: string | null,
  opts: { resetCollections?: string[]; restoreLayout?: boolean } = {},
): Promise<{ id: string; number: number }> {
  const old = await getVersion(tx, siteId, versionId);
  if (!old.tree) throw new UserError("Only managed versions can be restored this way.");
  const head = await latestVersion(tx, siteId);
  const layout = opts.restoreLayout ?? true;
  const reset = new Set(opts.resetCollections ?? Object.keys({ ...old.data, ...head.data }));
  const data: SiteData = {};
  for (const key of new Set([...Object.keys(old.data), ...Object.keys(head.data)])) {
    const items = reset.has(key) ? old.data[key] : head.data[key];
    if (items?.length) data[key] = items;
  }
  const tree = layout ? old.tree : head.tree!;
  if (head.id === old.id) throw new UserError(`Version ${old.number} is already the latest.`);
  if (!diffTrees(head.tree!, tree).length && !diffData(head.data, data).length) {
    throw new UserError(`Nothing to restore: the latest version already matches version ${old.number} for what you chose.`);
  }
  const tables = [...reset].filter((k) => diffData({ [k]: head.data[k] ?? [] }, { [k]: data[k] ?? [] }).length);
  return createVersion(tx, siteId, {
    tree,
    data,
    parentId: head.id,
    source: "restore",
    summary: layout && !opts.resetCollections ? `Restored version ${old.number}` : [
      layout ? `Restored the layout of version ${old.number}` : "",
      tables.length ? `reset ${tables.join(", ")} from version ${old.number}` : "",
    ].filter(Boolean).join("; "),
    userId,
  });
}

/** Per collection, how the latest version differs from `version` — what a restore could reset. */
export async function restorableTables(tx: Tx, siteId: string, versionId: string): Promise<DataChange[]> {
  const [v, head] = [await getVersion(tx, siteId, versionId), await latestVersion(tx, siteId)];
  return diffData(head.data, v.data);
}

/**
 * A manual edit of the data — an entry added, changed, removed or moved in
 * the studio's Content editor — as a new version on top of the latest.
 */
export async function editData(
  tx: Tx,
  siteId: string,
  ops: DataOp[],
  userId: string | null,
): Promise<{ id: string; number: number }> {
  const head = await latestVersion(tx, siteId);
  if (!head.tree) throw new UserError("Code versions have no managed data.");
  let data: SiteData;
  try {
    data = applyDataOps(head.data, ops);
  } catch (e) {
    throw new UserError((e as Error).message);
  }
  return createVersion(tx, siteId, { tree: head.tree, data, parentId: head.id, source: "manual", userId });
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

/**
 * Save the brand kit and, when it changes how the site looks, add a version
 * with it applied to the newest version — unpublished, like any other change,
 * so the owner previews it before it goes live.
 */
export async function saveBrand(
  tx: Tx,
  siteId: string,
  input: Brand,
  userId: string | null,
): Promise<{ brand: Brand; version: { id: string; number: number } | null }> {
  const current = (await getSite(tx, siteId)).brand;
  // The AI's record of its own choices survives an owner's edit of other fields.
  const brand = parseBrand({ ...input, aiColors: current.aiColors });
  await tx.query("update sites set brand = $2, updated_at = now() where id = $1", [siteId, JSON.stringify(brand)]);
  const latest = await latestVersion(tx, siteId);
  if (!latest.tree) return { brand, version: null };
  const branded = applyBrand(latest.tree, brand);
  if (!diffTrees(latest.tree, branded).length) return { brand, version: null };
  const version = await createVersion(tx, siteId, {
    tree: branded,
    parentId: latest.id,
    source: "manual",
    summary: "Applied the brand kit",
    userId,
  });
  return { brand, version };
}

/** After an AI edit: remember what it chose for the colours the owner left open. */
export async function recordAiColors(tx: Tx, siteId: string, tree: SiteTree): Promise<void> {
  const brand = (await getSite(tx, siteId)).brand;
  const aiColors = aiChosenColors(tree, brand);
  await tx.query("update sites set brand = jsonb_set(brand, '{aiColors}', $2::jsonb) where id = $1", [siteId, JSON.stringify(aiColors)]);
}
