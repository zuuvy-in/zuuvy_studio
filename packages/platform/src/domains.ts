/**
 * Custom domains: www.mybusiness.in showing a Zuuvy Sites site, over HTTPS.
 *
 * The owner adds two CNAME records at their own DNS provider and we do the
 * rest — nobody moves nameservers:
 *
 *   1. the certificate's validation record  _abc.www.mybusiness.in → _xyz.acm-validations.aws
 *      (proves the domain is theirs; AWS then issues a certificate for it);
 *   2. the routing record  www.mybusiness.in → domains.zuuvy.site
 *      (domains.zuuvy.site is covered by the platform's own `*` record, so it
 *      always follows the load balancer, whatever its address).
 *
 * The worker requests the certificate in AWS Certificate Manager, attaches it
 * to the load balancer's HTTPS listener once issued (SNI picks it by name),
 * and marks the domain active once it resolves to us. Only then does the
 * renderer serve it (resolve_site_by_domain reads active rows only).
 *
 * All AWS calls sit behind `DomainProvider`: tests use a fake, and a server
 * without a listener configured (a laptop) verifies DNS only and serves over
 * whatever TLS sits in front of it.
 */
import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import {
  ACMClient,
  DeleteCertificateCommand,
  DescribeCertificateCommand,
  RequestCertificateCommand,
} from "@aws-sdk/client-acm";
import {
  AddListenerCertificatesCommand,
  ElasticLoadBalancingV2Client,
  RemoveListenerCertificatesCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { config, loadRootEnv } from "./config";
import { type Tx, UserError, isUniqueViolation, withTenant } from "./db";
import { domainConnectedEmail, queueEmail } from "./email";
import { PermanentError, enqueue } from "./outbox";

export const MAX_DOMAINS_PER_SITE = 5;
/** How long a domain may wait for its DNS records before we give up and release the certificate. */
export const VERIFY_WINDOW_HOURS = 72;

export type DomainStatus = "pending" | "verifying" | "active" | "failed";

export type Domain = {
  id: string;
  site_id: string;
  hostname: string;
  status: DomainStatus;
  certificate_arn: string | null;
  validation_name: string | null;
  validation_value: string | null;
  attached: boolean;
  last_error: string | null;
  checked_at: Date | null;
  verified_at: Date | null;
  created_at: Date;
};

const COLUMNS = `id, site_id, hostname, status, certificate_arn, validation_name, validation_value, attached,
  last_error, checked_at, verified_at, created_at`;

/** Where every custom domain's CNAME points. */
export function domainTarget(): string {
  loadRootEnv();
  return (process.env.CUSTOM_DOMAIN_TARGET || `domains.${config.platformDomain()}`).toLowerCase();
}

/**
 * "https://WWW.MyShop.in/about" → "www.myshop.in". International names come
 * back in their ASCII (punycode) form, which is what DNS and certificates use.
 */
/**
 * The platform's own root and its www twin. Only a platform admin may connect
 * them (to the site that should answer at zuuvy.site, the landing page); every
 * other name under the platform domain stays a site address, never a custom
 * domain. Both are covered by the platform certificate, so none is requested.
 */
export function platformHosts(): string[] {
  const root = config.platformDomain().toLowerCase();
  return [root, `www.${root}`];
}

export function isPlatformHost(hostname: string): boolean {
  return platformHosts().includes(hostname.toLowerCase());
}

export function normaliseHostname(raw: string, opts: { platformAdmin?: boolean } = {}): string {
  let s = raw.trim().toLowerCase();
  if (!s) throw new UserError("Enter a domain, like www.yourbusiness.in.");
  if (!/^[a-z]+:\/\//.test(s)) s = `https://${s}`;
  let host: string;
  try {
    host = new URL(s).hostname.replace(/\.$/, "");
  } catch {
    throw new UserError("That is not a domain name.");
  }
  if (isIP(host) || host.startsWith("[")) throw new UserError("Use a domain name, not an IP address.");
  if (host.includes("*")) throw new UserError("Wildcard domains are not supported; add each name you use.");
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(l)) || host.length > 253) {
    throw new UserError("That is not a domain name.");
  }
  if (!/[a-z]/.test(labels.at(-1)!)) throw new UserError("That is not a domain name.");
  const platform = config.platformDomain().toLowerCase();
  if (opts.platformAdmin && isPlatformHost(host)) return host;
  if (host === platform || host.endsWith(`.${platform}`)) {
    throw new UserError(`Addresses on ${platform} are set as the site's Zuuvy address, not as a custom domain.`);
  }
  return host;
}

/** A bare domain cannot hold a CNAME at most DNS providers. */
export function isApex(hostname: string): boolean {
  // Good enough for the hint it drives: two labels, or three under a two-part suffix (co.in, com.au…).
  const labels = hostname.split(".");
  if (labels.length === 2) return true;
  return labels.length === 3 && /^(co|com|net|org|gov|ac|edu|firm|gen|ind)$/.test(labels[1]!) && labels[2]!.length === 2;
}

export async function listDomains(tx: Tx, siteId: string): Promise<Domain[]> {
  return tx.query<Domain>(`select ${COLUMNS} from site_domains where site_id = $1 order by created_at`, [siteId]);
}

export async function addDomain(
  tenantId: string,
  siteId: string,
  raw: string,
  userId: string | null,
  opts: { platformAdmin?: boolean } = {},
): Promise<Domain> {
  const hostname = normaliseHostname(raw, opts);
  return withTenant(tenantId, async (tx) => {
    await tx.get("select id from sites where id = $1", [siteId], "site");
    const count = await tx.get<{ n: number }>("select count(*) as n from site_domains where site_id = $1", [siteId]);
    if (count.n >= MAX_DOMAINS_PER_SITE) throw new UserError(`A site can have up to ${MAX_DOMAINS_PER_SITE} domains.`);
    const taken = await tx.get<{ taken: boolean }>("select domain_taken($1) as taken", [hostname]);
    if (taken.taken) throw new UserError(`${hostname} is already connected to a site.`);
    let row: Domain;
    try {
      await tx.query("savepoint add_domain");
      row = await tx.get<Domain>(
        `insert into site_domains (tenant_id, site_id, hostname, status, created_by)
         values (app_tenant(), $1, $2, 'pending', $3) returning ${COLUMNS}`,
        [siteId, hostname, userId],
      );
      await tx.query("release savepoint add_domain");
    } catch (e) {
      await tx.query("rollback to savepoint add_domain");
      if (isUniqueViolation(e)) throw new UserError(`${hostname} is already connected to a site.`);
      throw e;
    }
    // Committed with the row: a crash between the two cannot leave a domain nobody works on.
    await enqueue(tx, "domain.provision", { domainId: row.id, startedAt: new Date().toISOString() });
    return row;
  });
}

export async function removeDomain(tenantId: string, domainId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const row = await tx.get<Domain>(`delete from site_domains where id = $1 returning ${COLUMNS}`, [domainId], "domain");
    if (row.certificate_arn) await enqueue(tx, "domain.release", { certificateArn: row.certificate_arn });
  });
}

/** "Check again" in the studio: a check now, outside the regular schedule. */
export async function checkDomainNow(tenantId: string, domainId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const row = await tx.get<Domain>(`select ${COLUMNS} from site_domains where id = $1`, [domainId], "domain");
    if (row.status === "active") return;
    if (row.status === "failed") {
      // A fresh window: the owner says the records are there now.
      await tx.query("update site_domains set status = 'pending', last_error = null where id = $1", [row.id]);
      await enqueue(tx, "domain.provision", { domainId: row.id, startedAt: new Date().toISOString() });
      return;
    }
    await enqueue(tx, "domain.check", { domainId: row.id, startedAt: row.created_at.toISOString(), manual: true });
  });
}

// ---------------------------------------------------------------------------
// The AWS side
// ---------------------------------------------------------------------------

export type CertificateState = {
  status: "PENDING_VALIDATION" | "ISSUED" | "FAILED" | "VALIDATION_TIMED_OUT" | "REVOKED" | "EXPIRED" | "INACTIVE" | string;
  validation: { name: string; value: string } | null;
  failure: string | null;
};

export type DomainProvider = {
  requestCertificate(hostname: string, idempotencyToken: string): Promise<string>;
  describeCertificate(arn: string): Promise<CertificateState>;
  attach(arn: string): Promise<void>;
  detach(arn: string): Promise<void>;
  deleteCertificate(arn: string): Promise<void>;
};

let providerOverride: DomainProvider | null | undefined;
export function setDomainProvider(p: DomainProvider | null | undefined): void {
  providerOverride = p;
}

export function domainProvider(): DomainProvider | null {
  if (providerOverride !== undefined) return providerOverride;
  loadRootEnv();
  const listenerArn = process.env.ZSITE_DOMAIN_LISTENER_ARN;
  if (!listenerArn) return null;
  const region = process.env.AWS_REGION || "ap-south-1";
  const acm = new ACMClient({ region });
  const elb = new ElasticLoadBalancingV2Client({ region });
  return {
    async requestCertificate(hostname, token) {
      const res = await acm.send(
        new RequestCertificateCommand({
          DomainName: hostname,
          ValidationMethod: "DNS",
          IdempotencyToken: token,
          Tags: [{ Key: "project", Value: "zuuvy-sites" }, { Key: "zsite-domain", Value: hostname }],
        }),
      );
      if (!res.CertificateArn) throw new Error("ACM returned no certificate");
      return res.CertificateArn;
    },
    async describeCertificate(arn) {
      const res = await acm.send(new DescribeCertificateCommand({ CertificateArn: arn }));
      const c = res.Certificate;
      const record = c?.DomainValidationOptions?.[0]?.ResourceRecord;
      return {
        status: c?.Status ?? "UNKNOWN",
        validation: record?.Name && record.Value ? { name: record.Name, value: record.Value } : null,
        failure: c?.FailureReason ?? null,
      };
    },
    async attach(arn) {
      await elb.send(new AddListenerCertificatesCommand({ ListenerArn: listenerArn, Certificates: [{ CertificateArn: arn }] }));
    },
    async detach(arn) {
      await elb.send(new RemoveListenerCertificatesCommand({ ListenerArn: listenerArn, Certificates: [{ CertificateArn: arn }] }));
    },
    async deleteCertificate(arn) {
      await acm.send(new DeleteCertificateCommand({ CertificateArn: arn }));
    },
  };
}

export type DnsCheck = { ok: boolean; found: string[] };
export type DnsChecker = (hostname: string, target: string) => Promise<DnsCheck>;

let dnsOverride: DnsChecker | undefined;
export function setDnsChecker(c: DnsChecker | undefined): void {
  dnsOverride = c;
}

/**
 * Does the name reach us? A CNAME to the target is the plain answer; for a
 * provider that flattens CNAMEs (or an apex ALIAS), the addresses matching
 * the target's addresses counts too.
 */
export async function checkDns(hostname: string, target: string): Promise<DnsCheck> {
  if (dnsOverride) return dnsOverride(hostname, target);
  // Public resolvers, so a record the owner just added is seen without our VPC's cache.
  const r = new Resolver({ timeout: 4000, tries: 2 });
  r.setServers(["1.1.1.1", "8.8.8.8"]);
  const cname = await r.resolveCname(hostname).catch(() => [] as string[]);
  if (cname.some((c) => c.toLowerCase().replace(/\.$/, "") === target)) return { ok: true, found: cname };
  const [mine, theirs] = await Promise.all([r.resolve4(target).catch((): string[] => []), r.resolve4(hostname).catch((): string[] => [])]);
  const ok = theirs.length > 0 && theirs.every((a) => mine.includes(a));
  return { ok, found: cname.length ? cname : theirs };
}

/** Seconds until the next automatic check: brisk while people are likely watching, then patient. */
export function nextCheckDelay(elapsedSeconds: number): number {
  if (elapsedSeconds < 30 * 60) return 60;
  if (elapsedSeconds < 6 * 3600) return 5 * 60;
  return 30 * 60;
}

async function loadDomain(tenantId: string, domainId: string): Promise<Domain | undefined> {
  return withTenant(tenantId, (tx) => tx.one<Domain>(`select ${COLUMNS} from site_domains where id = $1`, [domainId]));
}

async function updateDomain(tenantId: string, domainId: string, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields);
  await withTenant(tenantId, (tx) =>
    tx.query(
      `update site_domains set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, checked_at = now() where id = $1`,
      [domainId, ...keys.map((k) => fields[k])],
    ),
  );
}

/** Job: request the certificate and record its validation record. */
export async function provisionDomain(tenantId: string, domainId: string, startedAt: string): Promise<void> {
  const d = await loadDomain(tenantId, domainId);
  if (!d) return; // removed meanwhile
  const provider = domainProvider();
  if (!provider || isPlatformHost(d.hostname)) {
    // No load balancer to manage (local), or a name the platform certificate
    // already covers: DNS alone decides.
    await updateDomain(tenantId, domainId, { status: "verifying" });
    await withTenant(tenantId, (tx) => enqueue(tx, "domain.check", { domainId, startedAt }));
    return;
  }
  let arn = d.certificate_arn;
  if (!arn) {
    // ACM's idempotency token (≤32 word characters): a retried job gets the same certificate, not a second one.
    arn = await provider.requestCertificate(d.hostname, domainId.replace(/-/g, "").slice(0, 32));
    await updateDomain(tenantId, domainId, { certificate_arn: arn, status: "verifying" });
  }
  const cert = await provider.describeCertificate(arn);
  // ACM fills the validation record in a few seconds after the request; the retry waits for it.
  if (!cert.validation) throw new Error("waiting for the certificate's validation record");
  await updateDomain(tenantId, domainId, { validation_name: cert.validation.name, validation_value: cert.validation.value, status: "verifying" });
  await withTenant(tenantId, (tx) => enqueue(tx, "domain.check", { domainId, startedAt }, 30));
}

/** Job: one look at the certificate and the DNS; schedules the next look until done. */
export async function checkDomain(tenantId: string, domainId: string, startedAt: string, manual = false): Promise<DomainStatus> {
  const d = await loadDomain(tenantId, domainId);
  if (!d || d.status === "active" || d.status === "failed") return d?.status ?? "failed";
  const provider = isPlatformHost(d.hostname) ? null : domainProvider();
  const problems: string[] = [];
  let certOk = !provider;
  let attached = d.attached;

  if (provider && d.certificate_arn) {
    const cert = await provider.describeCertificate(d.certificate_arn);
    if (cert.status === "ISSUED") {
      certOk = true;
      if (!attached) {
        await provider.attach(d.certificate_arn);
        attached = true;
        await updateDomain(tenantId, domainId, { attached: true });
      }
    } else if (cert.status === "PENDING_VALIDATION") {
      problems.push("Waiting for the validation record (the first CNAME) to appear in your DNS.");
    } else {
      await updateDomain(tenantId, domainId, { status: "failed", last_error: `The certificate could not be issued (${cert.failure ?? cert.status}).` });
      return "failed";
    }
  }

  const target = domainTarget();
  const dns = await checkDns(d.hostname, target);
  if (!dns.ok) {
    problems.push(
      dns.found.length
        ? `${d.hostname} points to ${dns.found.join(", ")}, not ${target}.`
        : `${d.hostname} does not point anywhere yet — add the CNAME to ${target}.`,
    );
  }

  if (certOk && (attached || !provider) && dns.ok) {
    await updateDomain(tenantId, domainId, { status: "active", last_error: null, verified_at: new Date() });
    await withTenant(tenantId, async (tx) => {
      const who = await tx.one<{ email: string; site: string }>(
        `select u.email::text as email, s.name as site from site_domains d
           join sites s on s.id = d.site_id left join users u on u.id = d.created_by where d.id = $1`,
        [domainId],
      );
      if (who?.email) await queueEmail(tx, domainConnectedEmail(who.email, d.hostname, who.site));
    });
    return "active";
  }

  const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000;
  if (elapsed > VERIFY_WINDOW_HOURS * 3600) {
    await updateDomain(tenantId, domainId, {
      status: "failed",
      last_error: `Not connected within ${VERIFY_WINDOW_HOURS} hours: ${problems.join(" ")} Fix the records and press "Check again".`,
    });
    return "failed";
  }
  await updateDomain(tenantId, domainId, { last_error: problems.join(" ") || null });
  // A manual check does not start a second chain of automatic ones.
  if (!manual) await withTenant(tenantId, (tx) => enqueue(tx, "domain.check", { domainId, startedAt }, nextCheckDelay(elapsed)));
  return "verifying";
}

/** Job: take a removed domain's certificate off the listener and delete it. */
export async function releaseCertificate(certificateArn: string): Promise<void> {
  const provider = domainProvider();
  if (!provider) return;
  const ignoreMissing = (e: unknown) => {
    const name = (e as { name?: string }).name ?? "";
    if (/NotFound/i.test(name)) return;
    throw e;
  };
  await provider.detach(certificateArn).catch(ignoreMissing);
  try {
    await provider.deleteCertificate(certificateArn);
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    if (/NotFound/i.test(name)) return;
    // The listener lets go of a certificate a little after the call returns; the retry deletes it.
    if (/ResourceInUse/i.test(name)) throw new Error("certificate still in use by the listener; retrying");
    throw new PermanentError(`could not delete ${certificateArn}: ${(e as Error).message}`);
  }
}
