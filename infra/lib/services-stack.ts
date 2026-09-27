/**
 * ZsiteServices: the three containers and the way in.
 *
 *   studio.<domain>        → studio   (dashboard, server actions, webhook receiver)
 *   <domain>, *.<domain>   → renderer (every tenant's live site)
 *   (no inbound)           → worker   (outbox: orders to Zuuvy, catalogue syncs)
 *
 * One Application Load Balancer with a wildcard certificate routes by Host.
 * Custom domains (CloudFront SaaS Manager, Route 53 registration) come later
 * in front of the same renderer target group.
 */
import { CfnOutput, Duration, IgnoreMode, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
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

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: cfg.hostedZoneId,
      zoneName: cfg.domain,
    });

    const certificate = new acm.Certificate(this, "Cert", {
      domainName: cfg.domain,
      subjectAlternativeNames: [`*.${cfg.domain}`],
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const albSg = new ec2.SecurityGroup(this, "AlbSg", { vpc: base.vpc, description: "Zuuvy Sites load balancer" });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP (redirected)");
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
    alb.addListener("Http", {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({ protocol: "HTTPS", port: "443", permanent: true }),
    });

    // --- containers -------------------------------------------------------

    const env: Record<string, string> = {
      NODE_ENV: "production",
      APP_VERSION: cfg.appVersion,
      PLATFORM_DOMAIN: cfg.domain,
      SITE_URL_TEMPLATE: `https://{sub}.${cfg.domain}`,
      PUBLIC_API_URL: `https://${cfg.studioHost}`,
      DB_HOST: base.db.clusterEndpoint.hostname,
      DB_PORT: String(base.db.clusterEndpoint.port),
      DB_NAME,
      DB_SSL: "1",
      ZSITE_AI_PROVIDER: "bedrock",
      AWS_REGION: this.region,
      ZUUVY_API_URL: cfg.zuuvyApiUrl,
      ZSITE_ALLOW_CUSTOM_ZUUVY_URL: "0",
      ...(cfg.aiModel ? { ZSITE_AI_MODEL: cfg.aiModel } : {}),
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
      opts: { cpu: number; memory: number; count: number; port?: number; command?: string[]; bedrock?: boolean },
    ) => {
      const task = new ecs.FargateTaskDefinition(this, `${name}Task`, { cpu: opts.cpu, memoryLimitMiB: opts.memory });
      if (opts.bedrock) task.addToTaskRolePolicy(bedrock);
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

    const studio = service("Studio", nextImage("studio"), { cpu: 512, memory: 1024, count: 1, port: 3000, bedrock: true });
    const renderer = service("Renderer", nextImage("renderer"), { cpu: 512, memory: 1024, count: 2, port: 3000 });
    service("Worker", base.toolsImage, { cpu: 256, memory: 512, count: 1, command: ["npx", "tsx", "scripts/worker.ts"], bedrock: true });

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

    const https = alb.addListener("Https", {
      port: 443,
      certificates: [certificate],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      defaultAction: elbv2.ListenerAction.forward([rendererTg]),
    });
    https.addAction("Studio", {
      priority: 10,
      conditions: [elbv2.ListenerCondition.hostHeaders([cfg.studioHost])],
      action: elbv2.ListenerAction.forward([studioTg]),
    });

    const scaling = renderer.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 6 });
    scaling.scaleOnCpuUtilization("Cpu", { targetUtilizationPercent: 60 });

    // --- DNS ----------------------------------------------------------------

    const alias = route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb));
    new route53.ARecord(this, "ApexRecord", { zone, target: alias });
    new route53.ARecord(this, "WildcardRecord", { zone, recordName: `*.${cfg.domain}`, target: alias });
    new route53.ARecord(this, "StudioRecord", { zone, recordName: cfg.studioHost, target: alias });

    new CfnOutput(this, "StudioUrl", { value: `https://${cfg.studioHost}` });
    new CfnOutput(this, "SitesUrl", { value: `https://<name>.${cfg.domain}` });
    new CfnOutput(this, "LoadBalancerDns", { value: alb.loadBalancerDnsName });
  }
}
