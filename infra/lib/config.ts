/**
 * Deploy-time settings. Everything comes from the environment the CDK runs
 * in — GitHub repository *variables* in CI (see docs/DEPLOYMENT.md), your
 * shell locally. None of these are secrets: application secrets are generated
 * inside AWS Secrets Manager by the stacks and never pass through CI.
 */
export type DeployConfig = {
  account: string;
  region: string;
  domain: string;
  hostedZoneId: string;
  /** The domain's nameservers are on the Route 53 zone, so certificates can validate. */
  domainReady: boolean;
  /** Who serves the domain's DNS: "route53" (records written by the stack) or "external" (added by hand at the registrar). */
  dnsProvider: "route53" | "external";
  /** An ACM certificate issued outside the stack — required with external DNS. */
  certificateArn: string;
  studioHost: string;
  appVersion: string;
  aiModel: string;
  zuuvyApiUrl: string;
  /** Aurora PostgreSQL engine version; must be one the region offers. */
  dbEngineVersion: string;
  dbMinAcu: number;
  dbMaxAcu: number;
  /** Send email through SES. Off until the domain's DKIM records are in and SES has left the sandbox. */
  emailEnabled: boolean;
  /** Bedrock image model and the region it is called from. */
  imageModel: string;
  imageRegion: string;
};

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — see docs/DEPLOYMENT.md`);
  return v;
}

export function loadConfig(): DeployConfig {
  const domain = process.env.PLATFORM_DOMAIN || "zuuvy.site";
  const dnsProvider = process.env.DNS_PROVIDER === "external" ? "external" : "route53";
  if (process.env.DOMAIN_READY === "true") {
    if (dnsProvider === "route53" && !process.env.HOSTED_ZONE_ID) {
      throw new Error("DOMAIN_READY=true with Route 53 DNS needs HOSTED_ZONE_ID — see docs/DEPLOYMENT.md");
    }
    if (dnsProvider === "external" && !process.env.CERTIFICATE_ARN) {
      throw new Error("DNS_PROVIDER=external needs CERTIFICATE_ARN (an issued ACM certificate) — see docs/DEPLOYMENT.md");
    }
  }
  return {
    account: process.env.CDK_DEFAULT_ACCOUNT || required("AWS_ACCOUNT_ID"),
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "ap-south-1",
    domain,
    hostedZoneId: process.env.HOSTED_ZONE_ID || "",
    domainReady: process.env.DOMAIN_READY === "true",
    dnsProvider,
    certificateArn: process.env.CERTIFICATE_ARN || "",
    studioHost: `${process.env.STUDIO_SUBDOMAIN || "studio"}.${domain}`,
    appVersion: process.env.APP_VERSION || "local",
    aiModel: process.env.ZSITE_AI_MODEL || "",
    zuuvyApiUrl: process.env.ZUUVY_API_URL || "https://api.zuuvy.in",
    // AWS retires old minor versions (16.6 was already gone in ap-south-1), so
    // this is a variable: `aws rds describe-db-engine-versions --engine
    // aurora-postgresql --query "DBEngineVersions[].EngineVersion"` lists what exists.
    // Changing it on a running cluster performs an in-place upgrade.
    dbEngineVersion: process.env.DB_ENGINE_VERSION || "16.11",
    // Aurora Serverless v2 capacity. 0 lets the database pause when idle (a
    // cold start of ~15s on the first request); 0.5 keeps it warm.
    // `||`, not `??`: an unset GitHub variable arrives as "", which must mean the default.
    dbMinAcu: Number(process.env.DB_MIN_ACU || 0.5),
    dbMaxAcu: Number(process.env.DB_MAX_ACU || 4),
    emailEnabled: process.env.EMAIL_ENABLED === "true" || process.env.EMAIL_ENABLED === "1",
    // Nova 2 Omni through its global inference profile, called from the stack's region.
    imageModel: process.env.ZSITE_IMAGE_MODEL || "global.amazon.nova-2-omni-v1:0",
    imageRegion: process.env.ZSITE_IMAGE_REGION || process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "ap-south-1",
  };
}
