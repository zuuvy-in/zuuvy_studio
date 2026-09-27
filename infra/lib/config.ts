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
  studioHost: string;
  appVersion: string;
  aiModel: string;
  zuuvyApiUrl: string;
  dbMinAcu: number;
  dbMaxAcu: number;
};

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — see docs/DEPLOYMENT.md`);
  return v;
}

export function loadConfig(): DeployConfig {
  const domain = process.env.PLATFORM_DOMAIN || "zuuvy.site";
  if (process.env.DOMAIN_READY === "true" && !process.env.HOSTED_ZONE_ID) {
    throw new Error("DOMAIN_READY=true needs HOSTED_ZONE_ID — see docs/DEPLOYMENT.md");
  }
  return {
    account: process.env.CDK_DEFAULT_ACCOUNT || required("AWS_ACCOUNT_ID"),
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "ap-south-1",
    domain,
    hostedZoneId: process.env.HOSTED_ZONE_ID || "",
    domainReady: process.env.DOMAIN_READY === "true",
    studioHost: `${process.env.STUDIO_SUBDOMAIN || "studio"}.${domain}`,
    appVersion: process.env.APP_VERSION || "local",
    aiModel: process.env.ZSITE_AI_MODEL || "",
    zuuvyApiUrl: process.env.ZUUVY_API_URL || "https://api.zuuvy.in",
    // Aurora Serverless v2 capacity. 0 lets the database pause when idle (a
    // cold start of ~15s on the first request); 0.5 keeps it warm.
    // `||`, not `??`: an unset GitHub variable arrives as "", which must mean the default.
    dbMinAcu: Number(process.env.DB_MIN_ACU || 0.5),
    dbMaxAcu: Number(process.env.DB_MAX_ACU || 4),
  };
}
