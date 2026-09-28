/**
 * Getting a site out, and back in.
 *
 * Site archive (.zip) — everything about one site, for keeping or moving:
 *   zuuvy-site-archive.json   the site, brand kit, domains, publications,
 *                             orders placed through it, and an index of versions and pictures
 *   versions/0001.json …      every version's full tree
 *   current/…                 the newest version as editable source files
 *   assets/…                  the pictures the site uses that live in our storage
 * Deleting a site requires one of these, downloaded after the newest version
 * was made (sites.exported_at / exported_seq), so nothing is ever deleted
 * that the owner does not have a copy of.
 *
 * Revision source (.zip) — one version as editable files (core/source.ts),
 * which comes back in as a new version after the owner has edited it.
 */
import { type SiteData, type SiteTree, TreeError, parseBrand, parseData, parseTree, sourceToTree, treeToSource } from "@zsite/core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { type Tx, UserError, withTenant } from "./db";
import { enqueue } from "./outbox";
import { sniffImage } from "./media";
import { type Site, checkSubdomain, createVersion, getSite, getVersionByNumber, latestVersion, listVersions, publishVersion } from "./sites";
import { storage } from "./storage";

export const ARCHIVE_FORMAT = "zuuvy-site-archive";
const MAX_UNZIPPED_BYTES = 300 * 1024 * 1024;
const MAX_ENTRIES = 5000;
/** How long a downloaded export counts as fresh enough to delete against. */
export const EXPORT_FRESH_HOURS = 24;

type ArchiveManifest = {
  format: typeof ARCHIVE_FORMAT;
  formatVersion: 1;
  exportedAt: string;
  site: { name: string; kind: string; subdomain: string; runtime_version: string; brand: unknown; published_number: number | null };
  versions: { number: number; parent_number: number | null; source: string; prompt: string | null; summary: string; ai_meta: unknown; created_at: string; created_by: string | null }[];
  publications: { number: number; previous_number: number | null; published_at: string; published_by: string | null }[];
  domains: { hostname: string; status: string }[];
  assets: { path: string | null; url: string; kind: string; alt: string; prompt: string | null; content_type: string }[];
  orders: unknown[];
};

/** Every https URL anywhere in a tree. */
function urlsIn(tree: SiteTree): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (/^https:\/\//.test(v)) out.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(tree);
  return [...out];
}

/**
 * Build the archive and stamp the site as exported. The stamp is the version
 * count the archive holds, so a later version makes it stale for deletion.
 */
export async function exportSite(tenantId: string, siteId: string): Promise<{ filename: string; bytes: Uint8Array }> {
  const data = await withTenant(tenantId, async (tx) => {
    const site = await getSite(tx, siteId);
    const versions = await tx.query<{
      number: number; parent_number: number | null; source: string; prompt: string | null; summary: string;
      ai_meta: unknown; created_at: Date; created_by: string | null; tree: SiteTree | null; data: SiteData;
    }>(
      `select v.number, p.number as parent_number, v.source, v.prompt, v.summary, v.ai_meta, v.created_at,
              u.email::text as created_by, v.tree, v.data
         from site_versions v
         left join site_versions p on p.id = v.parent_id
         left join users u on u.id = v.created_by
        where v.site_id = $1 order by v.number`,
      [siteId],
    );
    const publications = await tx.query<{ number: number; previous_number: number | null; published_at: Date; published_by: string | null }>(
      `select v.number, pv.number as previous_number, sp.published_at, u.email::text as published_by
         from site_publications sp join site_versions v on v.id = sp.version_id
         left join site_versions pv on pv.id = sp.previous_version_id
         left join users u on u.id = sp.published_by
        where sp.site_id = $1 order by sp.published_at`,
      [siteId],
    );
    const domains = await tx.query<{ hostname: string; status: string }>("select hostname, status from site_domains where site_id = $1", [siteId]);
    const assets = await tx.query<{ url: string; storage_key: string; kind: string; alt: string; prompt: string | null; content_type: string; site_id: string | null }>(
      "select url, storage_key, kind, alt, prompt, content_type, site_id from assets",
    );
    const orders = await tx.query(
      `select o.*, coalesce((select jsonb_agg(e order by e.created_at) from order_events e where e.order_id = o.id), '[]') as events
         from orders o where o.site_id = $1 order by o.created_at`,
      [siteId],
    );
    return { site, versions, publications, domains, assets, orders };
  });

  const files: Record<string, Uint8Array> = {};
  const used = new Set(data.versions.flatMap((v) => (v.tree ? urlsIn(v.tree) : [])));
  const store = storage();
  const assetIndex: ArchiveManifest["assets"] = [];
  for (const a of data.assets) {
    if (a.site_id !== siteId && !used.has(a.url)) continue;
    let path: string | null = null;
    const bytes = store ? await store.get(a.storage_key).catch(() => null) : null;
    if (bytes) {
      path = `assets/${a.storage_key.split("/").pop()}`;
      files[path] = bytes;
    }
    assetIndex.push({ path, url: a.url, kind: a.kind, alt: a.alt, prompt: a.prompt, content_type: a.content_type });
  }

  const latest = data.versions.at(-1);
  for (const v of data.versions) {
    if (v.tree) files[`versions/${String(v.number).padStart(4, "0")}.json`] = strToU8(JSON.stringify(v.tree, null, 2));
    if (Object.keys(v.data ?? {}).length) files[`versions/${String(v.number).padStart(4, "0")}.data.json`] = strToU8(JSON.stringify(v.data, null, 2));
  }
  if (latest?.tree) {
    for (const [p, content] of Object.entries(treeToSource(latest.tree, { siteName: data.site.name, kind: data.site.kind, version: latest.number }, latest.data))) {
      files[`current/${p}`] = strToU8(content);
    }
  }

  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    site: {
      name: data.site.name,
      kind: data.site.kind,
      subdomain: data.site.subdomain,
      runtime_version: data.site.runtime_version,
      brand: data.site.brand,
      published_number: data.site.published_number,
    },
    versions: data.versions.map(({ tree: _tree, data: _data, created_at, ...v }) => ({ ...v, created_at: created_at.toISOString() })),
    publications: data.publications.map((p) => ({ ...p, published_at: p.published_at.toISOString() })),
    domains: data.domains,
    assets: assetIndex,
    orders: data.orders,
  };
  files["zuuvy-site-archive.json"] = strToU8(JSON.stringify(manifest, null, 2));

  // Pictures are already compressed; storing them avoids burning CPU for nothing.
  const bytes = zipSync(
    Object.fromEntries(Object.entries(files).map(([p, b]) => [p, [b, { level: p.startsWith("assets/") ? 0 : 6 }]])),
  );

  await withTenant(tenantId, (tx) =>
    tx.query("update sites set exported_at = now(), exported_seq = version_seq where id = $1", [siteId]),
  );
  const day = new Date().toISOString().slice(0, 10);
  return { filename: `${data.site.subdomain}-site-export-${day}.zip`, bytes };
}

/** Unzip untrusted bytes without letting a zip bomb take the process down. */
export function readZip(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  let count = 0;
  try {
    return unzipSync(bytes, {
      filter: (f) => {
        if (++count > MAX_ENTRIES) throw new UserError("That archive has too many files.");
        total += f.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new UserError("That archive is too large once unpacked.");
        // Skip macOS metadata and directories.
        return !f.name.startsWith("__MACOSX/") && !f.name.endsWith("/") && !f.name.split("/").some((p) => p === "..");
      },
    });
  } catch (e) {
    if (e instanceof UserError) throw e;
    throw new UserError("That file is not a zip archive.");
  }
}

function textFiles(files: Record<string, Uint8Array>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [p, b] of Object.entries(files)) if (p.endsWith(".json")) out[p] = strFromU8(b);
  return out;
}

export type DeletionCheck = { ok: boolean; reason: string | null; exportedAt: Date | null };

/** Whether this site may be deleted now: a fresh export holding every version. */
export async function deletionCheck(tx: Tx, siteId: string): Promise<DeletionCheck> {
  const row = await tx.get<{ exported_at: Date | null; exported_seq: number | null; version_seq: number; fresh: boolean }>(
    `select exported_at, exported_seq, version_seq,
            coalesce(exported_at > now() - make_interval(hours => $2), false) as fresh
       from sites where id = $1`,
    [siteId, EXPORT_FRESH_HOURS],
    "site",
  );
  if (!row.exported_at) return { ok: false, reason: "Download the site's export first.", exportedAt: null };
  if (row.exported_seq !== row.version_seq) return { ok: false, reason: "A version was made after the last export — download a new one.", exportedAt: row.exported_at };
  if (!row.fresh) return { ok: false, reason: `The last export is more than ${EXPORT_FRESH_HOURS} hours old — download a new one.`, exportedAt: row.exported_at };
  return { ok: true, reason: null, exportedAt: row.exported_at };
}

/**
 * Delete a site for good. Versions, publications and domains go with it;
 * orders placed through it stay (their site becomes empty) because they are
 * the business's records; pictures stay in the media library.
 */
export async function deleteSite(tenantId: string, siteId: string, confirmName: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const site = await tx.get<{ name: string }>("select name from sites where id = $1 for update", [siteId], "site");
    if (confirmName.trim() !== site.name) throw new UserError("Type the site's name exactly to confirm.");
    const check = await deletionCheck(tx, siteId);
    if (!check.ok) throw new UserError(check.reason!);
    const certs = await tx.query<{ certificate_arn: string }>(
      "select certificate_arn from site_domains where site_id = $1 and certificate_arn is not null",
      [siteId],
    );
    for (const c of certs) await enqueue(tx, "domain.release", { certificateArn: c.certificate_arn });
    await tx.query("update sites set published_version_id = null where id = $1", [siteId]);
    await tx.query("delete from sites where id = $1", [siteId]);
  });
}

export type ImportInput = { name: string; subdomain: string; bytes: Uint8Array; userId: string };

/**
 * Create a site from an archive (every version) or from revision source (one
 * version). Pictures in the archive are stored again for this business and
 * their URLs rewritten, so the new site never depends on the old one's files.
 */
export async function importSite(tenantId: string, input: ImportInput): Promise<Site> {
  const files = readZip(input.bytes);
  const text = textFiles(files);
  const manifestPath = Object.keys(text).filter((p) => p.endsWith("zuuvy-site-archive.json")).sort((a, b) => a.length - b.length)[0];

  let versions: { tree: SiteTree; data: SiteData; number: number; source: string; prompt: string | null; summary: string; parent: number | null }[];
  let brand: unknown = {};
  let kind: string;
  let published: number | null = null;
  const rewrites = new Map<string, string>();

  if (manifestPath) {
    const root = manifestPath.slice(0, -"zuuvy-site-archive.json".length);
    const manifest = JSON.parse(text[manifestPath]!) as ArchiveManifest;
    if (manifest.format !== ARCHIVE_FORMAT) throw new UserError("That is not a Zuuvy site archive.");
    kind = manifest.site.kind;
    brand = manifest.site.brand;
    published = manifest.site.published_number;
    versions = manifest.versions.map((v) => {
      const raw = text[`${root}versions/${String(v.number).padStart(4, "0")}.json`];
      if (!raw) throw new UserError(`The archive is missing version ${v.number}.`);
      const rawData = text[`${root}versions/${String(v.number).padStart(4, "0")}.data.json`];
      try {
        return {
          tree: parseTree(JSON.parse(raw)),
          data: parseData(rawData ? JSON.parse(rawData) : {}),
          number: v.number, source: v.source, prompt: v.prompt, summary: v.summary, parent: v.parent_number,
        };
      } catch (e) {
        throw new UserError(`Version ${v.number} in the archive is not valid: ${(e as Error).message}`);
      }
    });
    const store = storage();
    if (store) {
      for (const a of manifest.assets) {
        const bytes = a.path ? files[`${root}${a.path}`] : undefined;
        const type = bytes && sniffImage(bytes);
        if (!bytes || !type) continue;
        const key = `t/${tenantId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${type.ext}`;
        const url = await store.put(key, bytes, type.type);
        rewrites.set(a.url, url);
        await withTenant(tenantId, (tx) =>
          tx.query(
            `insert into assets (tenant_id, storage_key, url, kind, content_type, bytes, alt, prompt, created_by)
             values (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8)`,
            [key, url, a.kind === "generated" ? "generated" : "upload", type.type, bytes.length, a.alt ?? "", a.prompt, input.userId],
          ),
        );
      }
    }
  } else {
    try {
      const { tree, manifest, data } = sourceToTree(text);
      kind = manifest.site.kind;
      versions = [{ tree, data, number: 1, source: "import", prompt: null, summary: "Imported from source files", parent: null }];
    } catch (e) {
      if (e instanceof TreeError) throw new UserError(e.message);
      throw e;
    }
  }
  if (!versions.length) throw new UserError("The archive has no versions.");
  if (!["landing", "portfolio", "store"].includes(kind)) kind = "landing";

  const swap = <T>(value: T): T => {
    if (!rewrites.size) return value;
    let json = JSON.stringify(value);
    for (const [from, to] of rewrites) json = json.split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1));
    return JSON.parse(json) as T;
  };
  const rewrite = (tree: SiteTree): SiteTree => parseTree(swap(tree));

  return withTenant(tenantId, async (tx) => {
    const name = input.name.trim();
    if (!name) throw new UserError("Give the site a name.");
    const { subdomain, problem } = await checkSubdomain(tx, input.subdomain);
    if (problem) throw new UserError(problem);
    const cleanBrand = parseBrand(brand);
    const row = await tx.get<{ id: string }>(
      `insert into sites (tenant_id, name, kind, subdomain, runtime_version, brand)
       values (app_tenant(), $1, $2, $3, '1', $4) returning id`,
      [name, kind, subdomain, JSON.stringify({ ...cleanBrand, logo: cleanBrand.logo && (rewrites.get(cleanBrand.logo) ?? cleanBrand.logo) })],
    );
    const ids = new Map<number, string>();
    let publishId: string | null = null;
    for (const v of versions) {
      const created = await createVersion(tx, row.id, {
        tree: rewrite(v.tree),
        data: parseData(swap(v.data)),
        parentId: v.parent !== null ? (ids.get(v.parent) ?? null) : null,
        source: (["template", "ai", "manual", "restore", "import"].includes(v.source) ? v.source : "import") as "import",
        prompt: v.prompt,
        summary: v.summary || `Imported version ${v.number}`,
        userId: input.userId,
      });
      ids.set(v.number, created.id);
      if (v.number === published) publishId = created.id;
    }
    await publishVersion(tx, row.id, publishId ?? [...ids.values()].at(-1)!, input.userId);
    return getSite(tx, row.id);
  });
}

/** One version as editable source files. */
export async function exportRevision(tenantId: string, siteId: string, number: number): Promise<{ filename: string; bytes: Uint8Array }> {
  return withTenant(tenantId, async (tx) => {
    const site = await getSite(tx, siteId);
    const v = await getVersionByNumber(tx, siteId, number);
    if (!v.tree) throw new UserError("Code versions have no managed source to export.");
    const files = treeToSource(v.tree, { siteName: site.name, kind: site.kind, version: v.number }, v.data);
    const folder = `${site.subdomain}-v${v.number}`;
    const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([p, c]) => [`${folder}/${p}`, strToU8(c)])));
    return { filename: `${folder}.zip`, bytes };
  });
}

/** Edited source files back in as a new, unpublished version. */
export async function importRevision(
  tenantId: string,
  siteId: string,
  bytes: Uint8Array,
  userId: string,
): Promise<{ id: string; number: number }> {
  let tree: SiteTree;
  let data: SiteData;
  let from: number | null;
  try {
    const parsed = sourceToTree(textFiles(readZip(bytes)));
    tree = parsed.tree;
    data = parsed.data;
    from = parsed.manifest.version;
  } catch (e) {
    if (e instanceof TreeError) throw new UserError(e.message);
    throw e;
  }
  return withTenant(tenantId, async (tx) => {
    const versions = await listVersions(tx, siteId, 1000);
    const parent = versions.find((v) => v.number === from) ?? (await latestVersion(tx, siteId));
    return createVersion(tx, siteId, {
      tree,
      data,
      parentId: parent.id,
      source: "import",
      summary: from ? `Imported edited source of version ${from}` : "Imported source files",
      userId,
    });
  });
}
