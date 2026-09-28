/**
 * "Make it look like example.com": fetch a reference website and reduce it to
 * what a designer would note — headings, navigation, section outline,
 * colours, fonts, a sample of the copy.
 *
 * The URL comes from a person's prompt, via the model, and the server fetches
 * it: an SSRF door by construction. So it is narrow:
 *   - http(s) only, ports 80/443 only, no credentials in the URL;
 *   - every address the name resolves to is checked, and the connection is
 *     made to the checked address (the lookup is pinned into the socket, so a
 *     second DNS answer cannot swap in 169.254.169.254 or 10.x — rebinding);
 *   - redirects are followed by hand (at most 3), each hop re-checked;
 *   - HTML only, 1.5 MB, 10 seconds, and the response never reaches the
 *     browser — only the summary goes to the model.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import type { ReferenceSummary } from "@zsite/ai";
import { UserError } from "./db";

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

const blocked = new BlockList();
// IPv6 rules live apart: Node matches IPv4 lookups against IPv4-mapped IPv6 rules too.
const blocked6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) {
  blocked6.addSubnet(net, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  // An IPv4-mapped IPv6 address (::ffff:127.0.0.1) is judged as the IPv4 address it carries.
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPublicAddress(mapped[1]!);
  const family = isIP(address);
  if (!family) return false;
  return family === 4 ? !blocked.check(address, "ipv4") : !blocked6.check(address, "ipv6");
}

/** Validates the URL's shape; throws a UserError naming what is wrong. */
export function checkReferenceUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UserError(`"${raw}" is not a web address.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UserError("Only http and https addresses can be used as references.");
  if (url.username || url.password) throw new UserError("Reference addresses cannot carry a username or password.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new UserError("Reference addresses must use the standard web ports.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) throw new UserError("That address is not a public website.");
  if (/^(localhost|.*\.localhost|.*\.internal|.*\.local)$/i.test(host)) throw new UserError("That address is not a public website.");
  return url;
}

/** A DNS lookup for the socket that refuses anything non-public. */
type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;
function safeLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback): void {
  dnsLookup(hostname, { all: true, verbatim: true })
    .then((addresses) => {
      const bad = addresses.find((a) => !isPublicAddress(a.address));
      if (!addresses.length || bad) {
        const err = new Error("That address is not a public website.") as NodeJS.ErrnoException;
        err.code = "EZSITE_PRIVATE";
        return callback(err, "", 0);
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0]!.address, addresses[0]!.family);
    })
    .catch((e) => callback(e as NodeJS.ErrnoException, "", 0));
}

type Fetched = { url: string; status: number; contentType: string; body: string; location?: string };

function fetchOnce(url: URL): Promise<Fetched> {
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(
      url,
      {
        lookup: safeLookup as never,
        timeout: TIMEOUT_MS,
        headers: {
          "user-agent": "ZuuvySitesReference/1.0 (+https://zuuvy.site)",
          accept: "text/html,application/xhtml+xml;q=0.9",
          "accept-language": "en-IN,en;q=0.9",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ url: url.href, status, contentType, body: "", location: String(res.headers.location ?? "") });
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy();
            // Keep what arrived: the head and the first screens are what matter.
            resolve({ url: url.href, status, contentType, body: Buffer.concat(chunks).toString("utf8") });
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ url: url.href, status, contentType, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("The reference site took too long to answer.")));
    req.on("error", reject);
  });
}

export async function fetchReferenceHtml(raw: string): Promise<{ url: string; html: string }> {
  let url = checkReferenceUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Fetched;
    try {
      res = await fetchOnce(url);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "EZSITE_PRIVATE") throw new UserError("That address is not a public website.");
      if (err.code === "ENOTFOUND") throw new UserError(`${url.hostname} does not exist.`);
      throw new UserError(`Could not open ${url.hostname}: ${err.message}`);
    }
    if (res.location !== undefined) {
      if (!res.location) throw new UserError(`${url.hostname} redirected nowhere.`);
      url = checkReferenceUrl(new URL(res.location, url).href);
      continue;
    }
    if (res.status >= 400) throw new UserError(`${url.hostname} answered ${res.status}.`);
    if (!/html/i.test(res.contentType)) throw new UserError(`${url.hostname} did not return a web page.`);
    return { url: res.url, html: res.body };
  }
  throw new UserError(`${url.hostname} redirected too many times.`);
}

// ---------------------------------------------------------------------------
// Plugins: the one other place the server calls an address a business gave
// it. Same guard — public addresses only, DNS pinned into the socket — and
// tighter still: https only, no redirects at all, a small JSON answer, and a
// few seconds, because a customer's cart is waiting on it.
// ---------------------------------------------------------------------------

/** Checks a plugin address when it is saved. */
export function checkPluginUrl(raw: string): URL {
  const url = checkReferenceUrl(raw);
  if (url.protocol !== "https:") throw new UserError("A plugin address must start with https://.");
  return url;
}

export async function postJson(
  raw: string,
  body: string,
  headers: Record<string, string>,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ status: number; json: unknown }> {
  const url = checkPluginUrl(raw);
  const timeout = opts.timeoutMs ?? 3000;
  const max = opts.maxBytes ?? 64_000;
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        lookup: safeLookup as never,
        timeout,
        headers: { "content-type": "application/json", "user-agent": "ZuuvySitesPlugin/1.0", "content-length": Buffer.byteLength(body), ...headers },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > max) {
            req.destroy(new Error("The plugin's answer was too large."));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (status >= 300) return reject(new Error(`The plugin answered ${status}.`));
          try {
            resolve({ status, json: text ? JSON.parse(text) : {} });
          } catch {
            reject(new Error("The plugin did not answer with JSON."));
          }
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`The plugin took longer than ${timeout / 1000}s.`)));
    req.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "EZSITE_PRIVATE" ? new Error("The plugin address is not a public website.") : e));
    req.end(body);
  });
}

// ---------------------------------------------------------------------------
// Reading the page. A regex pass rather than a DOM: this runs on untrusted
// markup and needs only a designer's notes, so nothing here executes or
// resolves anything the page names.
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…" };

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function textOf(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function unique<T>(xs: T[], max: number): T[] {
  return [...new Set(xs)].filter(Boolean).slice(0, max);
}

export function summariseHtml(url: string, raw: string): ReferenceSummary {
  const html = raw.replace(/<!--[\s\S]*?-->/g, "");
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n") +
    [...html.matchAll(/\sstyle="([^"]*)"/gi)].map((m) => m[1]).join(";");
  const body = html.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ");

  const meta = (name: string) =>
    decode(
      html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)`, "i"))?.[1] ??
        html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i"))?.[1] ??
        "",
    ).trim();

  const title = textOf(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || meta("og:title");
  const description = meta("description") || meta("og:description");

  const headings = unique(
    [...body.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => `${"#".repeat(Number(m[1]))} ${textOf(m[2]!)}`.slice(0, 140)),
    30,
  );

  const navBlock = body.match(/<nav[\s\S]*?<\/nav>/i)?.[0] ?? body.match(/<header[\s\S]*?<\/header>/i)?.[0] ?? "";
  const navigation = unique([...navBlock.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => textOf(m[1]!).slice(0, 40)), 12);

  // A section outline: each <section>'s first heading, else its first words.
  const sections = unique(
    [...body.matchAll(/<section[^>]*>([\s\S]*?)<\/section>/gi)].map((m) => {
      const h = m[1]!.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1];
      return (h ? textOf(h) : textOf(m[1]!).split(" ").slice(0, 10).join(" ")).slice(0, 100);
    }),
    16,
  );

  // Colours by frequency, ignoring near-black/near-white noise last.
  const counts = new Map<string, number>();
  const themeColor = meta("theme-color");
  for (const m of `${styles} ${themeColor}`.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let hex = m[1]!.toLowerCase();
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    counts.set(`#${hex}`, (counts.get(`#${hex}`) ?? 0) + 1);
  }
  let colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  // The page's declared brand colour leads, whatever its count.
  if (themeColor && /^#[0-9a-f]{6}$/i.test(themeColor)) colors = [themeColor.toLowerCase(), ...colors.filter((c) => c !== themeColor.toLowerCase())];
  colors = colors.slice(0, 8);

  const fonts = unique(
    [
      ...[...html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'>\s]+)/gi)].flatMap((m) =>
        [...decode(m[1]!).matchAll(/family=([^:&]+)/g)].map((f) => decodeURIComponent(f[1]!.replace(/\+/g, " "))),
      ),
      ...[...styles.matchAll(/font-family\s*:\s*["']?([^;,"'}]+)/gi)].map((m) => m[1]!.trim()),
    ].filter((f) => !/^(inherit|initial|sans-serif|serif|monospace|system-ui|var\()/i.test(f)),
    6,
  );

  const text = textOf(body.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? body.match(/<body[\s\S]*<\/body>/i)?.[0] ?? body).slice(0, 2500);

  return { url, title: title.slice(0, 200), description: description.slice(0, 400), headings, navigation, sections, colors, fonts, text };
}

export async function fetchReference(raw: string): Promise<ReferenceSummary> {
  const { url, html } = await fetchReferenceHtml(raw);
  return summariseHtml(url, html);
}
