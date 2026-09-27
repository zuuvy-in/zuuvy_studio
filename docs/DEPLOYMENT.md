# Deploying Zuuvy Sites to AWS

A push to `main` runs `.github/workflows/deploy.yml`: tests → `ZsiteBase` →
database migration → `ZsiteServices` → smoke test. The infrastructure is AWS
CDK in `infra/`, and every run creates or updates whatever is missing — the
first run builds everything from nothing.

## What gets created

| Stack | Resources |
|---|---|
| `ZsiteBase` | VPC (2 AZs, no NAT), Aurora PostgreSQL 16 Serverless v2 (encrypted, TLS enforced, 7-day backups, deletion protection), Secrets Manager secrets (admin and app database passwords, the credential-sealing key — names generated, find them by the stack's Resources tab), ECS cluster, migration task |
| `ZsiteServices` | Application Load Balancer, ACM wildcard certificate for `zuuvy.site` + `*.zuuvy.site`, Route 53 records (apex, `*`, `studio`), Fargate services: studio ×1, renderer ×2–6 (CPU autoscaling), worker ×1, CloudWatch log groups, IAM access to Amazon Bedrock |

Rough running cost at the defaults: about $150–200/month (Aurora at 0.5 ACU,
four small Fargate tasks, the load balancer, public IPv4 addresses), plus
Bedrock usage — all AWS services, so startup credits apply. Set `DB_MIN_ACU=0`
to let the database pause when idle.

## GitHub: what to store

**No secrets.** AWS access is by OIDC federation — GitHub proves the job is
this repository's `production` environment and AWS hands it short-lived
credentials. Application secrets (database passwords, the credential-sealing
key) are generated inside AWS Secrets Manager by the stacks and never pass
through GitHub.

Create an environment: **Settings → Environments → New environment →
`production`**. Under *Deployment branches and tags*, allow only `main`.
Optionally add required reviewers to approve each deploy. Then add these
**environment variables** (not secrets — none of them is sensitive):

| Variable | Example | What |
|---|---|---|
| `AWS_ACCOUNT_ID` | `123456789012` | The AWS account to deploy into |
| `AWS_REGION` | `ap-south-1` | Region for everything (Mumbai) |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::123456789012:role/zsite-github-deploy` | Output of the bootstrap stack (step 2 below) |
| `PLATFORM_DOMAIN` | `zuuvy.site` | The platform domain |
| `HOSTED_ZONE_ID` | `Z0123456789ABCDEFGHIJ` | Route 53 hosted zone of that domain (used once `DOMAIN_READY=true`) |
| `DNS_PROVIDER` | *(optional)* `external` | DNS stays at the registrar; needs `CERTIFICATE_ARN`. See "Keeping DNS at the registrar" |
| `CERTIFICATE_ARN` | *(optional)* `arn:aws:acm:ap-south-1:…` | An issued ACM certificate for `zuuvy.site` + `*.zuuvy.site` |
| `DOMAIN_READY` | *(optional)* `true` | Set once `zuuvy.site`'s nameservers point at the Route 53 zone. Until then (unset) the studio and sites are served on CloudFront `*.cloudfront.net` addresses — see "Before the domain is ready" |
| `ZSITE_AI_MODEL` | *(optional)* `apac.amazon.nova-pro-v1:0` | Bedrock model for AI edits; empty = that default |
| `DB_MIN_ACU` | *(optional)* `0.5` | Aurora minimum capacity; `0` pauses when idle |
| `DB_ENGINE_VERSION` | *(optional)* `16.11` | Aurora PostgreSQL version. AWS retires old minor versions; list what the region offers with `aws rds describe-db-engine-versions --engine aurora-postgresql --region ap-south-1 --query "DBEngineVersions[].EngineVersion"` |

If you later switch AI editing to Claude, put `ANTHROPIC_API_KEY` in AWS
Secrets Manager and inject it in `infra/lib/services-stack.ts` — not in GitHub.

## AWS: one-time setup (about 15 minutes, in the console)

1. **Hosted zone for `zuuvy.site`.** Route 53 → Hosted zones. If the domain
   was registered through Route 53 the zone already exists; otherwise create
   it and set the four NS records at your registrar. Copy the **Hosted zone
   ID** → `HOSTED_ZONE_ID`. The certificate cannot validate until the domain
   resolves through this zone.
2. **Deploy role.** CloudFormation → Create stack → Upload
   `infra/bootstrap/github-oidc.yaml` → stack name `zsite-github`. Keep the
   defaults (org `zuuvy-in`, repo `zuuvy_ai_site`, environment `production`,
   and the organisation's and repository's numeric ids — this organisation
   sends GitHub's ID-pinned subject, `repo:zuuvy-in@309228253/zuuvy_ai_site@1390232775:…`);
   set `CreateOidcProvider` to `false` only if IAM → Identity providers
   already lists `token.actions.githubusercontent.com`. Copy the
   **DeployRoleArn** output → `AWS_DEPLOY_ROLE_ARN`.
3. **CDK bootstrap.** Open **CloudShell** in `ap-south-1` and run:
   ```bash
   npx -y aws-cdk@2 bootstrap aws://<ACCOUNT_ID>/ap-south-1
   ```
   This creates the roles and asset buckets CDK deploys through; the deploy
   role only assumes those roles and holds no broad permissions itself.
4. **Bedrock.** Nothing to enable: serverless models (Amazon Nova included)
   switch on for the account the first time they are invoked. To check before
   the first AI edit, open Amazon Nova Pro in the Bedrock playground in
   `ap-south-1` and send one message. "Operation not allowed" there means AWS
   has not opened Bedrock to the account yet (new accounts can be held back,
   like CloudFront) — open a Support case under Account and billing.

## Keeping DNS at the registrar (Hostinger)

No nameserver change and no CloudFront needed — the load balancer serves
`studio.zuuvy.site` and `<name>.zuuvy.site` over HTTPS with a certificate you
request once:

1. **ACM (Mumbai, `ap-south-1`) → Request certificate → public.** Names:
   `zuuvy.site` and `*.zuuvy.site`; DNS validation. Open it and copy the
   **CNAME name** and **CNAME value** shown (one record covers both names).
2. **Hostinger → DNS zone for zuuvy.site → add a CNAME** with that name (the
   part before `.zuuvy.site`) and value. Within minutes to an hour the
   certificate shows **Issued**. Copy its **ARN**.
3. **GitHub variables:** `DOMAIN_READY=true`, `DNS_PROVIDER=external`,
   `CERTIFICATE_ARN=<the ARN>`. Re-run the workflow.
4. The deploy prints the **load balancer DNS name**. At Hostinger add two
   CNAMEs pointing at it: `studio` and `*`. (The bare `zuuvy.site` stays
   wherever it points now.)

Moving the nameservers to Route 53 later: set `DNS_PROVIDER` back to empty
(Route 53), remove `CERTIFICATE_ARN`, redeploy.

## Before the domain is ready

This mode needs CloudFront, which **new AWS accounts cannot use until AWS
Support verifies them** ("Your account must be verified before you can add
new CloudFront resources"). Open a case under Account and billing if you hit
that — or use the registrar-DNS mode above instead.

With `DOMAIN_READY` unset, nothing waits on DNS: the services stack puts two
CloudFront distributions (HTTPS on their own `*.cloudfront.net` names) in
front of the load balancer instead of the certificate and Route 53 records.

- The deploy job prints both addresses, and the studio address is the
  environment URL on the run's page.
- A site is viewed at `<storefront address>/?site=<name>` — the choice is kept
  in a cookie, so links within the site work. The studio's "live" links use
  this form automatically.
- CloudFront waits at most 60 seconds for an answer; an AI edit that takes
  longer shows a 504, though the version is still saved.

When the nameservers move to Route 53, set `DOMAIN_READY=true` and re-run the
workflow: the certificate is issued, `studio.zuuvy.site` and
`<name>.zuuvy.site` start answering, and the CloudFront distributions are
removed. Nothing in the database changes.

## First deploy

Merge to `main` (or push the first commit to it). The first run takes about
30–40 minutes — most of it Aurora creation and certificate validation. Then:

- `https://studio.zuuvy.site/signup` — create the first business account.
- Sites appear at `https://<name>.zuuvy.site`.
- Pull requests run the tests, the builds and `cdk synth`, and never deploy.

## Operating it

- **Logs:** CloudWatch → Log groups → `ZsiteServices-StudioLogs…`,
  `…RendererLogs…`, `…WorkerLogs…`, and `ZsiteBase-MigrateLogs…`.
- **A failed deploy** rolls back on its own: ECS's deployment circuit breaker
  returns the services to the last healthy task definition, and CloudFormation
  rolls back the stack.
- **A failed migration** stops the pipeline before any service changes; its
  log is printed in the job.
- **Database access** for debugging: ECS Exec into a worker task, or a
  temporary bastion. The database has no public endpoint.
- **Deleting everything:** the database has deletion protection and snapshots
  on delete; the `zsite/app` secret is retained. Disable protection
  deliberately before `cdk destroy`.
