/**
 * ZsiteServices: the three containers and the way in.
 *
 *   studio.<domain>        → studio   (dashboard, server actions, webhook receiver)
 *   <domain>, *.<domain>   → renderer (every tenant's live site)
 *   (no inbound)           → worker   (outbox: orders to Zuuvy, catalogue syncs)
 *
 * Two ways in, chosen by DOMAIN_READY (and, for the domain, DNS_PROVIDER):
 *
 *   true   One Application Load Balancer with a wildcard ACM certificate for
 *          the platform domain routes by Host; Route 53 records point at it.
 *          Needs the domain's nameservers on the Route 53 hosted zone, or the
 *          certificate never validates.
 *   false  No domain yet: two CloudFront distributions (HTTPS on their own
 *          *.cloudfront.net names) in front of the balancer — one for the
 *          studio, one for the storefront, which picks the site by ?site=
 *          (apps/renderer/proxy.ts). Nothing waits on DNS.
 *
 * Switching is a redeploy with the variable changed.
 */
import { CfnOutput, Duration, IgnoreMode, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import type { Construct } from "constructs";
import { type BaseStack, DB_NAME, REPO_ROOT } from "./base-stack";
import type { DeployConfig } from "./config";

type ServicesProps = StackProps & { base: BaseStack; cfg: DeployConfig };

export class ServicesStack extends Stack {
  /** Fixed rather than looked up, so synthesis needs no AWS credentials. */
  override get availabilityZones(): string[] {
    return [`${this.region}a`, `${this.region}b`];
  }

  constructor(scope: Construct, id: string, { base, cfg, ...props }: ServicesProps) {
    super(scope, id, props);

    const albSg = new ec2.SecurityGroup(this, "AlbSg", { vpc: base.vpc, description: "Zuuvy Sites load balancer" });
    // The services' own group: the balancer's attachment adds "from the ALB on
    // 3000" to it automatically, and nothing else is let in.
    const taskSg = new ec2.SecurityGroup(this, "TaskSg", { vpc: base.vpc, description: "Zuuvy Sites service tasks" });

    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc: base.vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      idleTimeout: Duration.seconds(180), // an AI edit is one long server action
    });

    // Where people reach the studio and the sites, per mode.
    let studioUrl: string;
    let siteUrlTemplate: string;
    let studioCdn: cloudfront.Distribution | undefined;
    let rendererCdn: cloudfront.Distribution | undefined;

    if (cfg.domainReady) {
      albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");
      albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP (redirected)");
      studioUrl = `https://${cfg.studioHost}`;
      siteUrlTemplate = `https://{sub}.${cfg.domain}`;
    } else {
      albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "Studio via CloudFront");
      albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8080), "Storefront via CloudFront");
      const cdn = (name: string, port: number, comment: string) =>
        new cloudfront.Distribution(this, name, {
          comment,
          defaultBehavior: {
            origin: new origins.LoadBalancerV2Origin(alb, {
              protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
              httpPort: port,
              // CloudFront's ceiling without a quota increase; an AI edit longer than this shows a 504.
              readTimeout: Duration.seconds(60),
            }),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            // Dynamic apps: nothing cached, and the Host, cookies and query reach the app.
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          },
          priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
        });
      studioCdn = cdn("StudioCdn", 80, "Zuuvy Sites studio (no custom domain yet)");
      rendererCdn = cdn("RendererCdn", 8080, "Zuuvy Sites storefront (no custom domain yet)");
      studioUrl = `https://${studioCdn.distributionDomainName}`;
      siteUrlTemplate = `https://${rendererCdn.distributionDomainName}/?site={sub}`;
    }

    // --- containers -------------------------------------------------------

    const env: Record<string, string> = {
      NODE_ENV: "production",
      APP_VERSION: cfg.appVersion,
      PLATFORM_DOMAIN: cfg.domain,
      SITE_URL_TEMPLATE: siteUrlTemplate,
      PUBLIC_API_URL: studioUrl,
      ...(cfg.domainReady ? {} : { ZSITE_SITE_PARAM: "1" }),
      DB_HOST: base.db.clusterEndpoint.hostname,
      DB_PORT: String(base.db.clusterEndpoint.port),
      DB_NAME,
      DB_SSL: "1",
      ZSITE_AI_PROVIDER: "bedrock",
      AWS_REGION: this.region,
      ZUUVY_API_URL: cfg.zuuvyApiUrl,
      ZSITE_ALLOW_CUSTOM_ZUUVY_URL: "0",
      ...(cfg.aiModel ? { ZSITE_AI_MODEL: cfg.aiModel } : {}),
      // Pictures: the media library bucket, and the Bedrock image model.
      ASSETS_BUCKET: base.assets.bucketName,
      ASSETS_REGION: this.region,
      ZSITE_IMAGE_MODEL: cfg.imageModel,
      ZSITE_IMAGE_REGION: cfg.imageRegion,
      // Email through SES from the platform domain.
      EMAIL_ENABLED: cfg.emailEnabled ? "1" : "0",
      EMAIL_DOMAIN: cfg.domain,
      SES_REGION: this.region,
      // Custom domains CNAME here; the platform's `*` record already points it at the balancer.
      CUSTOM_DOMAIN_TARGET: `domains.${cfg.domain}`,
    };
    const secrets = {
      DB_APP_PASSWORD: ecs.Secret.fromSecretsManager(base.appDbSecret, "password"),
      SECRETS_KEY: ecs.Secret.fromSecretsManager(base.appSecrets, "SECRETS_KEY"),
    };

    // Amazon Nova (and any Bedrock model named in ZSITE_AI_MODEL), including
    // cross-region inference profiles, which route to several regions.
    const bedrock = new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      resources: [
        "arn:aws:bedrock:*::foundation-model/*",
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
      ],
    });
    // Read-only: lets the image path find a model the account can call when the configured id is refused.
    const bedrockList = new iam.PolicyStatement({
      actions: ["bedrock:ListInferenceProfiles", "bedrock:ListFoundationModels", "bedrock:GetInferenceProfile"],
      resources: ["*"],
    });

    // The media library: writing and reading pictures (reading for exports).
    const assetsRw = new iam.PolicyStatement({
      actions: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      resources: [base.assets.arnForObjects("t/*")],
    });
    // Email, only from the two addresses the platform sends as.
    const sendEmail = new iam.PolicyStatement({
      actions: ["ses:SendEmail", "ses:SendRawEmail"],
      resources: [`arn:aws:ses:${this.region}:${this.account}:identity/${cfg.domain}`, `arn:aws:ses:${this.region}:${this.account}:configuration-set/*`],
      conditions: { StringEquals: { "ses:FromAddress": [`no-reply@${cfg.domain}`, `alerts@${cfg.domain}`] } },
    });

    const nextImage = (app: "studio" | "renderer") =>
      ecs.ContainerImage.fromAsset(REPO_ROOT, {
        file: "infra/docker/next.Dockerfile",
        buildArgs: { APP: app },
        platform: ecrAssets.Platform.LINUX_AMD64,
        ignoreMode: IgnoreMode.DOCKER,
      });

    const service = (
      name: string,
      image: ecs.ContainerImage,
      opts: { cpu: number; memory: number; count: number; port?: number; command?: string[]; bedrock?: boolean; policies?: iam.PolicyStatement[] },
    ) => {
      const task = new ecs.FargateTaskDefinition(this, `${name}Task`, { cpu: opts.cpu, memoryLimitMiB: opts.memory });
      if (opts.bedrock) {
        task.addToTaskRolePolicy(bedrock);
        task.addToTaskRolePolicy(bedrockList);
      }
      for (const p of opts.policies ?? []) task.addToTaskRolePolicy(p);
      task.addContainer(name, {
        image,
        command: opts.command,
        environment: env,
        secrets,
        portMappings: opts.port ? [{ containerPort: opts.port }] : [],
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: name,
          logGroup: new logs.LogGroup(this, `${name}Logs`, { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
        }),
      });
      return new ecs.FargateService(this, `${name}Service`, {
        cluster: base.cluster,
        taskDefinition: task,
        desiredCount: opts.count,
        assignPublicIp: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        securityGroups: [taskSg],
        circuitBreaker: { rollback: true },
        minHealthyPercent: 100,
        healthCheckGracePeriod: opts.port ? Duration.seconds(60) : undefined,
      });
    };

    // Custom domains: the worker requests certificates and hangs them on the
    // HTTPS listener. Filled in below once the listener exists (domain mode only).
    const domainCerts = new iam.PolicyStatement({
      actions: ["acm:RequestCertificate", "acm:DescribeCertificate", "acm:DeleteCertificate", "acm:AddTagsToCertificate"],
      resources: ["*"],
    });

    const studio = service("Studio", nextImage("studio"), { cpu: 512, memory: 1024, count: 1, port: 3000, bedrock: true, policies: [assetsRw, sendEmail] });
    const renderer = service("Renderer", nextImage("renderer"), { cpu: 512, memory: 1024, count: 2, port: 3000 });
    const worker = service("Worker", base.toolsImage, {
      cpu: 256,
      memory: 512,
      count: 1,
      command: ["npx", "tsx", "scripts/worker.ts"],
      bedrock: true,
      policies: [assetsRw, sendEmail, domainCerts],
    });

    const healthCheck: elbv2.HealthCheck = { path: "/api/health", healthyHttpCodes: "200", interval: Duration.seconds(20) };
    const rendererTg = new elbv2.ApplicationTargetGroup(this, "RendererTg", {
      vpc: base.vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [renderer],
      healthCheck,
      deregistrationDelay: Duration.seconds(30),
    });
    const studioTg = new elbv2.ApplicationTargetGroup(this, "StudioTg", {
      vpc: base.vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [studio],
      healthCheck,
      deregistrationDelay: Duration.seconds(30),
    });

    if (cfg.domainReady) {
      // Route 53 hosts the domain: the stack issues the certificate and writes
      // the records. Otherwise (DNS at the registrar, e.g. Hostinger) the
      // certificate is requested once by hand, validated with a CNAME added
      // there, and passed in as CERTIFICATE_ARN; `studio` and `*` then point
      // at LoadBalancerDns with CNAMEs at the registrar.
      const zone =
        cfg.dnsProvider === "route53"
          ? route53.HostedZone.fromHostedZoneAttributes(this, "Zone", { hostedZoneId: cfg.hostedZoneId, zoneName: cfg.domain })
          : undefined;
      const certificate = cfg.certificateArn
        ? acm.Certificate.fromCertificateArn(this, "Cert", cfg.certificateArn)
        : new acm.Certificate(this, "Cert", {
            domainName: cfg.domain,
            subjectAlternativeNames: [`*.${cfg.domain}`],
            validation: acm.CertificateValidation.fromDns(zone),
          });
      alb.addListener("Http", {
        port: 80,
        defaultAction: elbv2.ListenerAction.redirect({ protocol: "HTTPS", port: "443", permanent: true }),
      });
      const https = alb.addListener("Https", {
        port: 443,
        certificates: [certificate],
        sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
        defaultAction: elbv2.ListenerAction.forward([rendererTg]),
      });
      // The worker attaches each custom domain's certificate to this listener (SNI).
      worker.taskDefinition.addToTaskRolePolicy(
        new iam.PolicyStatement({
          actions: ["elasticloadbalancing:AddListenerCertificates", "elasticloadbalancing:RemoveListenerCertificates"],
          resources: [https.listenerArn],
        }),
      );
      worker.taskDefinition.defaultContainer?.addEnvironment("ZSITE_DOMAIN_LISTENER_ARN", https.listenerArn);
      studio.taskDefinition.defaultContainer?.addEnvironment("ZSITE_DOMAIN_LISTENER_ARN", https.listenerArn);
      https.addAction("Studio", {
        priority: 10,
        conditions: [elbv2.ListenerCondition.hostHeaders([cfg.studioHost])],
        action: elbv2.ListenerAction.forward([studioTg]),
      });
      if (zone) {
        const alias = route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb));
        new route53.ARecord(this, "ApexRecord", { zone, target: alias });
        new route53.ARecord(this, "WildcardRecord", { zone, recordName: `*.${cfg.domain}`, target: alias });
        new route53.ARecord(this, "StudioRecord", { zone, recordName: cfg.studioHost, target: alias });
      }
    } else {
      alb.addListener("Studio", { port: 80, protocol: elbv2.ApplicationProtocol.HTTP, defaultAction: elbv2.ListenerAction.forward([studioTg]) });
      alb.addListener("Storefront", { port: 8080, protocol: elbv2.ApplicationProtocol.HTTP, defaultAction: elbv2.ListenerAction.forward([rendererTg]) });
    }

    const scaling = renderer.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 6 });
    scaling.scaleOnCpuUtilization("Cpu", { targetUtilizationPercent: 60 });

    new CfnOutput(this, "StudioUrl", { value: studioUrl });
    new CfnOutput(this, "SitesUrl", { value: siteUrlTemplate.replace("{sub}", "<name>") });
    new CfnOutput(this, "LoadBalancerDns", { value: alb.loadBalancerDnsName });
  }
}
