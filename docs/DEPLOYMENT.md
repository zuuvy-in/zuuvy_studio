# Deploying Zuuvy Sites to AWS

A push to `main` runs `.github/workflows/deploy.yml`: tests → `ZsiteBase` →
database migration → `ZsiteServices` → smoke test. The infrastructure is AWS
CDK in `infra/`, and every run creates or updates whatever is missing — the
first run builds everything from nothing.

## What gets created

| Stack | Resources |
|---|---|
| `ZsiteBase` | VPC (2 AZs, no NAT), Aurora PostgreSQL 16 Serverless v2 (encrypted, TLS enforced, 7-day backups, deletion protection), Secrets Manager secrets (`zsite/db-admin`, `zsite/db-app`, `zsite/app`), ECS cluster, migration task |
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
| `HOSTED_ZONE_ID` | `Z0123456789ABCDEFGHIJ` | Route 53 hosted zone of that domain |
| `ZSITE_AI_MODEL` | *(optional)* `apac.amazon.nova-pro-v1:0` | Bedrock model for AI edits; empty = that default |
| `DB_MIN_ACU` | *(optional)* `0.5` | Aurora minimum capacity; `0` pauses when idle |

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
   defaults (org `zuuvy-in`, repo `zuuvy_ai_site`, environment `production`);
   set `CreateOidcProvider` to `false` only if IAM → Identity providers
   already lists `token.actions.githubusercontent.com`. Copy the
   **DeployRoleArn** output → `AWS_DEPLOY_ROLE_ARN`.
3. **CDK bootstrap.** Open **CloudShell** in `ap-south-1` and run:
   ```bash
   npx -y aws-cdk@2 bootstrap aws://<ACCOUNT_ID>/ap-south-1
   ```
   This creates the roles and asset buckets CDK deploys through; the deploy
   role only assumes those roles and holds no broad permissions itself.
4. **Bedrock.** Bedrock console (`ap-south-1`) → Model access: make sure
   Amazon Nova Pro is available to the account.

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
