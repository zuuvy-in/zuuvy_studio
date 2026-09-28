/**
 * A version as source files: what "export the code", "import a revision" and
 * GitHub sync all exchange.
 *
 *   zuuvy-site.json          manifest (format, schema, site, version)
 *   README.md                how to edit and bring it back
 *   site/meta.json           title and description
 *   site/theme.json          colours, fonts, corners, motion
 *   site/nav.json            header
 *   site/footer.json         footer
 *   site/pages/01-home.json  one file per page, in order: path, title, sections
 *   site/data/projects.json  one file per data collection (profile, projects, …)
 *
 * Plain JSON, one page per file, so a change reads well in a git diff and a
 * developer can edit any of it with any editor. Importing runs the files
 * through the same validation as every other version, so a hand edit that
 * breaks the schema is refused with the file and field named, never saved.
 */
import { COLLECTIONS, type SiteData, parseData } from "./data";
import { type SiteTree, TreeError, parseTree } from "./tree";

export const SOURCE_FORMAT = "zuuvy-site-source";
export const SOURCE_FORMAT_VERSION = 1;

export type SourceManifest = {
  format: typeof SOURCE_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  site: { name: string; kind: string };
  version: number | null;
  exportedAt: string;
};

export type SourceFiles = Record<string, string>;

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

function slug(path: string): string {
  return path === "/" ? "home" : path.replace(/^\//, "").replace(/\//g, "-");
}

export function treeToSource(
  tree: SiteTree,
  info: { siteName: string; kind: string; version: number | null; exportedAt?: Date },
  data: SiteData = {},
): SourceFiles {
  const manifest: SourceManifest = {
    format: SOURCE_FORMAT,
    formatVersion: SOURCE_FORMAT_VERSION,
    schemaVersion: tree.schemaVersion,
    site: { name: info.siteName, kind: info.kind },
    version: info.version,
    exportedAt: (info.exportedAt ?? new Date()).toISOString(),
  };
  const files: SourceFiles = {
    "zuuvy-site.json": json(manifest),
    "README.md": readme(info.siteName, info.version),
    "site/meta.json": json(tree.meta),
    "site/theme.json": json(tree.theme),
    "site/nav.json": json(tree.nav),
    "site/footer.json": json(tree.footer),
  };
  const width = String(tree.pages.length).length < 2 ? 2 : String(tree.pages.length).length;
  tree.pages.forEach((p, i) => {
    files[`site/pages/${String(i + 1).padStart(width, "0")}-${slug(p.path)}.json`] = json(p);
  });
  for (const c of COLLECTIONS) {
    if (data[c.key]?.length) files[`site/data/${c.key}.json`] = json(data[c.key]);
  }
  return files;
}

/**
 * Files back into a validated tree. Accepts the files at the root or inside
 * one folder (a zipped directory, a GitHub archive), and ignores anything
 * else in the tree — a README, a .git folder, an editor's backup files.
 */
export function sourceToTree(input: SourceFiles): { tree: SiteTree; manifest: SourceManifest; data: SiteData } {
  const manifestPath = Object.keys(input)
    .filter((p) => p === "zuuvy-site.json" || p.endsWith("/zuuvy-site.json"))
    .sort((a, b) => a.length - b.length)[0];
  if (!manifestPath) throw new TreeError("zuuvy-site.json is missing — this is not an exported Zuuvy site.");
  const root = manifestPath.slice(0, -"zuuvy-site.json".length);
  const files: SourceFiles = {};
  for (const [p, v] of Object.entries(input)) if (p.startsWith(root)) files[p.slice(root.length)] = v;

  const read = <T>(path: string): T => {
    const raw = files[path];
    if (raw === undefined) throw new TreeError(`${path} is missing.`);
    try {
      return JSON.parse(raw) as T;
    } catch (e) {
      throw new TreeError(`${path} is not valid JSON: ${(e as Error).message}`);
    }
  };

  const manifest = read<SourceManifest>("zuuvy-site.json");
  if (manifest.format !== SOURCE_FORMAT) throw new TreeError("zuuvy-site.json is not a Zuuvy site manifest.");
  if (manifest.formatVersion > SOURCE_FORMAT_VERSION) {
    throw new TreeError(`This export uses format ${manifest.formatVersion}; this platform reads up to ${SOURCE_FORMAT_VERSION}.`);
  }

  const pageFiles = Object.keys(files)
    .filter((p) => /^site\/pages\/[^/]+\.json$/.test(p))
    .sort();
  if (!pageFiles.length) throw new TreeError("site/pages/ has no page files.");

  const candidate = {
    schemaVersion: manifest.schemaVersion,
    meta: read("site/meta.json"),
    theme: read("site/theme.json"),
    nav: read("site/nav.json"),
    footer: read("site/footer.json"),
    pages: pageFiles.map((p) => read(p)),
  };
  const rawData: Record<string, unknown> = {};
  for (const p of Object.keys(files).filter((x) => /^site\/data\/[a-z]+\.json$/.test(x))) {
    rawData[p.slice("site/data/".length, -".json".length)] = read(p);
  }
  let data: SiteData;
  try {
    data = parseData(rawData);
  } catch (e) {
    throw new TreeError(`site/data: ${(e as Error).message}`);
  }
  try {
    return { tree: parseTree(candidate), manifest, data };
  } catch (e) {
    // Point at the file a person has to open, not just the JSON path.
    const message = (e as Error).message.replace(/pages\.(\d+)/g, (_, i) => `${pageFiles[Number(i)] ?? `page ${i}`}`);
    throw new TreeError(message);
  }
}

function readme(name: string, version: number | null): string {
  return `# ${name}${version ? ` — version ${version}` : ""}

Exported from Zuuvy Sites. This folder *is* the site: every page, section,
colour and link is in these JSON files.

## Editing

- \`site/pages/*.json\` — one file per page, in the order of the file names.
  Each page has a \`path\`, a \`title\` and its \`sections\`; a section is a
  \`type\` (hero, features, productGrid, richText, imageText, gallery,
  testimonials, stats, faq, cta, contact) with its \`props\`.
- \`site/theme.json\` — colours (\`#rrggbb\`), fonts, corner radius, motion
  (\`none\`, \`subtle\`, \`lively\`).
- \`site/nav.json\`, \`site/footer.json\`, \`site/meta.json\` — header, footer,
  title and description.
- \`site/data/*.json\` — the content collections (profile, projects,
  experience, skills…): a list of entries each, shown by \`collection\`
  sections. Keep each entry's \`id\`; give a new entry any unique id.
- Images are \`https://\` URLs. Section and page ids must stay unique.

## Bringing it back

Zip the folder and use **Import a revision** on the site's Versions page, or
push it to the site's GitHub repository and choose **Import from branch**.
Either way it becomes a new, unpublished version — checked in full first, so a
mistake is reported with the file and field rather than saved.
`;
}
