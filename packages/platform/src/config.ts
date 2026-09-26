/**
 * Environment. Read lazily so a test can set variables before first use, and
 * loaded from the repository's root `.env` when present, so every process —
 * both Next apps, the worker, scripts — sees one file.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

let loaded = false;

export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate) && existsSync(join(dir, "package.json")) && existsSync(join(dir, "packages"))) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        /* unreadable .env: fall back to the real environment */
      }
      return;
    }
    dir = dirname(dir);
  }
}

function env(name: string, fallback?: string): string {
  loadRootEnv();
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is not set — see .env.example`);
}

export const isProduction = () => process.env.NODE_ENV === "production";

export const config = {
  databaseUrl: () => env("DATABASE_URL", "postgres://zsite_app:zsite@127.0.0.1:54329/zsite"),
  databaseAdminUrl: () => env("DATABASE_ADMIN_URL", "postgres://postgres@127.0.0.1:54329/zsite"),
  platformDomain: () => env("PLATFORM_DOMAIN", "zuuvy.site"),
  /** How a site's live URL is written. `{sub}` is the subdomain. */
  siteUrlTemplate: () => env("SITE_URL_TEMPLATE", "https://{sub}.zuuvy.site"),
  /** Where webhooks reach this platform from the outside. */
  publicApiUrl: () => env("PUBLIC_API_URL", "http://localhost:3000"),
  secretsKey: () => process.env.SECRETS_KEY ?? "",
  aiModel: () => env("ZSITE_AI_MODEL", "claude-opus-5"),
};

export function siteUrl(subdomain: string): string {
  return config.siteUrlTemplate().replace("{sub}", subdomain);
}
