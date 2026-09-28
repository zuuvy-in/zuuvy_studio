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
  databaseUrl: () => env("DATABASE_URL", "") || urlFromParts("app") || "postgres://zsite_app:zsite@127.0.0.1:54329/zsite",
  databaseAdminUrl: () => env("DATABASE_ADMIN_URL", "") || urlFromParts("admin") || "postgres://postgres@127.0.0.1:54329/zsite",
  /** TLS to the database, verified against the system CAs plus NODE_EXTRA_CA_CERTS (the RDS bundle in the image). */
  databaseSsl: () => env("DB_SSL", "0") === "1",
  platformDomain: () => env("PLATFORM_DOMAIN", "zuuvy.site"),
  /** How a site's live URL is written. `{sub}` is the subdomain. */
  siteUrlTemplate: () => env("SITE_URL_TEMPLATE", "https://{sub}.zuuvy.site"),
  /** Where webhooks reach this platform from the outside. */
  publicApiUrl: () => env("PUBLIC_API_URL", "http://localhost:3000"),
  secretsKey: () => process.env.SECRETS_KEY ?? "",
  /** bedrock (Amazon Nova, AWS credits) or anthropic (Claude). */
  aiProvider: () => (env("ZSITE_AI_PROVIDER", "bedrock") === "anthropic" ? ("anthropic" as const) : ("bedrock" as const)),
  /** Empty = the provider's default model (see @zsite/ai DEFAULT_MODELS). */
  aiModel: () => env("ZSITE_AI_MODEL", ""),
  /**
   * Used when the configured model cannot be used at all (not enabled, IAM,
   * region). Unset = the provider's default model; "none" = no fallback.
   */
  aiFallbackModel: (): string | undefined => {
    const v = env("ZSITE_AI_FALLBACK_MODEL", "");
    return v === "" ? undefined : v === "none" ? "" : v;
  },
  /** Remote MCP servers for the editor: JSON [{name, url, headers?, tools?}] (see @zsite/ai mcp/client). */
  mcpServers: () => env("ZSITE_MCP_SERVERS", ""),
  /** Stock photos in the design kit: Unsplash first, else Pexels; neither = no photo search. */
  unsplashKey: () => env("UNSPLASH_ACCESS_KEY", ""),
  pexelsKey: () => env("PEXELS_API_KEY", ""),
};

/**
 * In AWS the connection parts arrive separately — host and port from the
 * stack, passwords injected from Secrets Manager — so the URL is assembled
 * here rather than stored anywhere as one secret string.
 */
function urlFromParts(who: "app" | "admin"): string {
  loadRootEnv();
  const host = process.env.DB_HOST;
  if (!host) return "";
  const port = process.env.DB_PORT || "5432";
  const name = process.env.DB_NAME || "zsite";
  const user = who === "app" ? process.env.DB_APP_USER || "zsite_app" : process.env.DB_ADMIN_USER || "postgres";
  const password = who === "app" ? process.env.DB_APP_PASSWORD : process.env.DB_ADMIN_PASSWORD;
  if (!password) return "";
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

export function siteUrl(subdomain: string): string {
  return config.siteUrlTemplate().replace("{sub}", subdomain);
}
