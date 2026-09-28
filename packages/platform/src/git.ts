/**
 * GitHub sync, per site.
 *
 *   new version  → branch `zuuvy/v<n>`: one commit, the version's source files
 *                  on top of the default branch (other files in the repo stay);
 *   publish      → the default branch becomes that version: a merge commit
 *                  whose parents are the default branch and the version's
 *                  branch, and whose tree is the published version — so
 *                  publishing an *older* version (a rollback) really rolls the
 *                  default branch back too, which a plain merge would not;
 *   import       → any branch's files come back as a new, unpublished version.
 *
 * Authentication is a fine-grained personal access token limited to one
 * repository with Contents read/write, sealed like every other credential.
 * The API host is fixed (api.github.com): nothing here fetches a URL a user
 * typed. All of it runs in the worker, from outbox jobs committed with the
 * version or the publish that caused them.
 */
import { type SiteData, type SiteTree, sourceToTree, treeToSource } from "@zsite/core";
import { type Tx, UserError, withTenant } from "./db";
import { PermanentError, enqueue } from "./outbox";
import { open, seal } from "./secrets";
import { createVersion, getSite, getVersion, latestVersion } from "./sites";

const API = "https://api.github.com";
export const BRANCH_PREFIX = "zuuvy/v";

export type GitLink = {
  site_id: string;
  owner: string;
  repo: string;
  default_branch: string;
  status: "active" | "error";
  last_error: string | null;
  last_synced_at: Date | null;
  created_at: Date;
};

type GitHubFetch = typeof fetch;
let fetchOverride: GitHubFetch | undefined;
/** For tests: a fake GitHub. */
export function setGitHubFetch(f: GitHubFetch | undefined): void {
  fetchOverride = f;
}

export class GitHubError extends Error {
  override name = "GitHubError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function client(token: string) {
  const f = fetchOverride ?? fetch;
  return async <T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await f(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "zuuvy-sites",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return {} as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new GitHubError(`GitHub ${method} ${path.split("?")[0]}: ${res.status} ${data.message ?? ""}`.trim(), res.status);
    return data as T;
  };
}

const REPO_PART = /^[A-Za-z0-9_.-]{1,100}$/;

/** "https://github.com/acme/site" or "acme/site" → { owner, repo }. */
export function parseRepo(raw: string): { owner: string; repo: string } {
  const m = raw.trim().replace(/\.git$/, "").replace(/\/+$/, "").match(/(?:github\.com[/:])?([^/\s]+)\/([^/\s]+)$/);
  if (!m || !REPO_PART.test(m[1]!) || !REPO_PART.test(m[2]!)) throw new UserError("Enter the repository as owner/name, like acme/website.");
  return { owner: m[1]!, repo: m[2]! };
}

export async function getGitLink(tx: Tx, siteId: string): Promise<GitLink | undefined> {
  return tx.one<GitLink>(
    `select site_id, owner, repo, default_branch, status, last_error, last_synced_at, created_at from site_git where site_id = $1`,
    [siteId],
  );
}

/**
 * Check the token can write to the repository, then store the link and push
 * the newest version (and the published one to the default branch).
 */
export async function connectGit(
  tenantId: string,
  siteId: string,
  input: { repo: string; token: string },
  userId: string | null,
): Promise<GitLink> {
  const { owner, repo } = parseRepo(input.repo);
  const token = input.token.trim();
  if (!/^(github_pat_|ghp_|gho_|ghs_)[A-Za-z0-9_]{20,}$/.test(token)) {
    throw new UserError("That does not look like a GitHub token. Create a fine-grained token with Contents: read and write on this repository.");
  }
  const gh = client(token);
  let info: { default_branch?: string; permissions?: { push?: boolean }; archived?: boolean };
  try {
    info = await gh("GET", `/repos/${owner}/${repo}`);
  } catch (e) {
    const status = (e as GitHubError).status;
    if (status === 401) throw new UserError("GitHub rejected the token.");
    if (status === 404) throw new UserError(`${owner}/${repo} was not found, or the token cannot see it.`);
    throw new UserError(`Could not reach GitHub: ${(e as Error).message}`);
  }
  if (info.archived) throw new UserError(`${owner}/${repo} is archived.`);
  if (info.permissions && !info.permissions.push) throw new UserError(`The token cannot write to ${owner}/${repo}. Give it Contents: read and write.`);

  return withTenant(tenantId, async (tx) => {
    await getSite(tx, siteId);
    const link = await tx.get<GitLink>(
      `insert into site_git (site_id, tenant_id, owner, repo, default_branch, credentials, created_by)
       values ($1, app_tenant(), $2, $3, $4, $5, $6)
       on conflict (site_id) do update set owner = excluded.owner, repo = excluded.repo,
         default_branch = excluded.default_branch, credentials = excluded.credentials, status = 'active', last_error = null
       returning site_id, owner, repo, default_branch, status, last_error, last_synced_at, created_at`,
      [siteId, owner, repo, info.default_branch || "main", seal({ token }), userId],
    );
    const latest = await latestVersion(tx, siteId);
    await enqueue(tx, "git.push", { siteId, versionId: latest.id });
    const live = await tx.one<{ published_version_id: string | null }>("select published_version_id from sites where id = $1", [siteId]);
    if (live?.published_version_id) await enqueue(tx, "git.merge", { siteId, versionId: live.published_version_id });
    return link;
  });
}

export async function disconnectGit(tenantId: string, siteId: string): Promise<void> {
  await withTenant(tenantId, (tx) => tx.query("delete from site_git where site_id = $1", [siteId]));
}

type Ctx = { gh: ReturnType<typeof client>; owner: string; repo: string; branch: string; path: string };

async function context(tenantId: string, siteId: string): Promise<Ctx | null> {
  const row = await withTenant(tenantId, (tx) =>
    tx.one<{ owner: string; repo: string; default_branch: string; credentials: string }>(
      "select owner, repo, default_branch, credentials from site_git where site_id = $1",
      [siteId],
    ),
  );
  if (!row) return null;
  const { token } = open<{ token: string }>(row.credentials);
  return { gh: client(token), owner: row.owner, repo: row.repo, branch: row.default_branch, path: `/repos/${row.owner}/${row.repo}` };
}

async function headOf(c: Ctx, branch: string): Promise<string | null> {
  try {
    const ref = await c.gh<{ object: { sha: string } }>("GET", `${c.path}/git/ref/heads/${branch}`);
    return ref.object.sha;
  } catch (e) {
    if ((e as GitHubError).status === 404 || (e as GitHubError).status === 409) return null;
    throw e;
  }
}

/** An empty repository has no commits for the Git Data API to build on; give it one. */
async function ensureDefaultBranch(c: Ctx): Promise<string> {
  const head = await headOf(c, c.branch);
  if (head) return head;
  await c.gh("PUT", `${c.path}/contents/README.md`, {
    message: "Start the Zuuvy Sites repository",
    content: Buffer.from("# Website\n\nManaged by Zuuvy Sites. Each version is a `zuuvy/v<n>` branch; the published one is on this branch.\n").toString("base64"),
    branch: c.branch,
  });
  const created = await headOf(c, c.branch);
  if (!created) throw new Error("could not initialise the repository");
  return created;
}

/**
 * A tree: `base`'s files, with the site's files replaced and page files the
 * version no longer has removed. Everything else in the repository survives.
 */
async function siteTree(c: Ctx, baseCommit: string, files: Record<string, string>): Promise<string> {
  const commit = await c.gh<{ tree: { sha: string } }>("GET", `${c.path}/git/commits/${baseCommit}`);
  const existing = await c.gh<{ tree: { path: string; type: string }[] }>("GET", `${c.path}/git/trees/${commit.tree.sha}?recursive=1`);
  const stalePages = existing.tree
    .filter((e) => e.type === "blob" && (e.path.startsWith("site/pages/") || e.path.startsWith("site/data/")) && !(e.path in files))
    .map((e) => ({ path: e.path, mode: "100644", type: "blob", sha: null }));
  const tree = await c.gh<{ sha: string }>("POST", `${c.path}/git/trees`, {
    base_tree: commit.tree.sha,
    tree: [...Object.entries(files).map(([path, content]) => ({ path, mode: "100644", type: "blob", content })), ...stalePages],
  });
  return tree.sha;
}

async function versionFiles(tenantId: string, siteId: string, versionId: string) {
  return withTenant(tenantId, async (tx) => {
    const site = await getSite(tx, siteId);
    const v = await getVersion(tx, siteId, versionId);
    if (!v.tree) throw new PermanentError("code versions are not synced");
    return {
      number: v.number,
      message: `v${v.number}: ${v.summary || "update"}${v.prompt ? `\n\nPrompt: ${v.prompt}` : ""}\n\nZuuvy-Version: ${v.number}`,
      files: treeToSource(v.tree, { siteName: site.name, kind: site.kind, version: v.number, exportedAt: v.created_at }, v.data),
    };
  });
}

async function markSynced(tenantId: string, siteId: string, error: string | null): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.query(
      `update site_git set status = $2, last_error = $3, last_synced_at = case when $3::text is null then now() else last_synced_at end
        where site_id = $1`,
      [siteId, error ? "error" : "active", error],
    ),
  );
}

/** Job: the version as branch zuuvy/v<n>. Idempotent — a rerun points the branch at a fresh identical commit. */
export async function pushVersion(tenantId: string, siteId: string, versionId: string): Promise<void> {
  const c = await context(tenantId, siteId);
  if (!c) return;
  try {
    const { number, message, files } = await versionFiles(tenantId, siteId, versionId);
    const base = await ensureDefaultBranch(c);
    const tree = await siteTree(c, base, files);
    const commit = await c.gh<{ sha: string }>("POST", `${c.path}/git/commits`, { message, tree, parents: [base] });
    const branch = `${BRANCH_PREFIX}${number}`;
    if (await headOf(c, branch)) {
      await c.gh("PATCH", `${c.path}/git/refs/heads/${branch}`, { sha: commit.sha, force: true });
    } else {
      await c.gh("POST", `${c.path}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
    }
    await markSynced(tenantId, siteId, null);
  } catch (e) {
    await failed(tenantId, siteId, e);
  }
}

/** Job: make the default branch the published version, recorded as a merge of its branch. */
export async function mergeVersion(tenantId: string, siteId: string, versionId: string): Promise<void> {
  const c = await context(tenantId, siteId);
  if (!c) return;
  try {
    const { number, files } = await versionFiles(tenantId, siteId, versionId);
    const branch = `${BRANCH_PREFIX}${number}`;
    if (!(await headOf(c, branch))) await pushVersion(tenantId, siteId, versionId);
    const branchHead = await headOf(c, branch);
    const base = await ensureDefaultBranch(c);
    const tree = await siteTree(c, base, files);
    const parents = branchHead && branchHead !== base ? [base, branchHead] : [base];
    const commit = await c.gh<{ sha: string }>("POST", `${c.path}/git/commits`, {
      message: `Publish v${number}\n\nMerge branch '${branch}' into ${c.branch} — this is now the live site.`,
      tree,
      parents,
    });
    // A fast-forward: the new commit's first parent is the branch head we just read.
    await c.gh("PATCH", `${c.path}/git/refs/heads/${c.branch}`, { sha: commit.sha, force: false });
    await markSynced(tenantId, siteId, null);
  } catch (e) {
    await failed(tenantId, siteId, e);
  }
}

async function failed(tenantId: string, siteId: string, e: unknown): Promise<never> {
  const err = e as GitHubError;
  const message =
    err.status === 401 ? "GitHub rejected the token — it may have expired. Connect again with a new token." :
    err.status === 403 ? "The token is not allowed to write to this repository (Contents: read and write)." :
    err.status === 404 ? "The repository is gone, or the token can no longer see it." :
    (err as Error).message;
  await markSynced(tenantId, siteId, message);
  // An auth problem does not fix itself by retrying; everything else might.
  if (err.status === 401 || err.status === 403 || err.status === 404 || e instanceof PermanentError) throw new PermanentError(message);
  throw e;
}

export async function listBranches(tenantId: string, siteId: string): Promise<string[]> {
  const c = await context(tenantId, siteId);
  if (!c) throw new UserError("Connect GitHub first.");
  const rows = await c.gh<{ name: string }[]>("GET", `${c.path}/branches?per_page=100`);
  return rows.map((r) => r.name);
}

/** Read the site's source files from a branch and save them as a new version. */
export async function importFromBranch(
  tenantId: string,
  siteId: string,
  branch: string,
  userId: string | null,
): Promise<{ id: string; number: number }> {
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(branch) || branch.includes("..")) throw new UserError("That is not a branch name.");
  const c = await context(tenantId, siteId);
  if (!c) throw new UserError("Connect GitHub first.");
  let tree: SiteTree;
  let data: SiteData;
  try {
    const head = await headOf(c, branch);
    if (!head) throw new UserError(`There is no branch called ${branch}.`);
    const commit = await c.gh<{ tree: { sha: string } }>("GET", `${c.path}/git/commits/${head}`);
    const listing = await c.gh<{ tree: { path: string; type: string; sha: string; size?: number }[]; truncated?: boolean }>(
      "GET",
      `${c.path}/git/trees/${commit.tree.sha}?recursive=1`,
    );
    const wanted = listing.tree.filter(
      (e) => e.type === "blob" && (e.path.endsWith("zuuvy-site.json") || /(^|\/)site\/.*\.json$/.test(e.path)) && (e.size ?? 0) < 2_000_000,
    );
    if (wanted.length > 200) throw new UserError("That branch has too many site files.");
    const files: Record<string, string> = {};
    for (const e of wanted) {
      const blob = await c.gh<{ content: string; encoding: string }>("GET", `${c.path}/git/blobs/${e.sha}`);
      files[e.path] = Buffer.from(blob.content, blob.encoding === "base64" ? "base64" : "utf8").toString("utf8");
    }
    ({ tree, data } = sourceToTree(files));
  } catch (e) {
    if (e instanceof UserError) throw e;
    if ((e as Error).name === "TreeError") throw new UserError(`${branch}: ${(e as Error).message}`);
    throw new UserError(`Could not read ${branch} from GitHub: ${(e as Error).message}`);
  }
  return withTenant(tenantId, async (tx) => {
    const head = await latestVersion(tx, siteId);
    return createVersion(tx, siteId, {
      tree,
      data,
      parentId: head.id,
      source: "import",
      summary: `Imported from GitHub branch ${branch}`,
      userId,
    });
  });
}
