/**
 * ZsiteBase: what the services stand on and what migrations need —
 * network, database, secrets, the ECS cluster, and the one-off migration task.
 * Deployed first; the pipeline then runs the migration task, then ZsiteServices.
 */
import { join } from "node:path";
import { CfnOutput, Duration, IgnoreMode, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";
import type { DeployConfig } from "./config";

export const REPO_ROOT = join(import.meta.dirname, "../..");
export const DB_NAME = "zsite";
const DB_ADMIN_USER = "zsite_admin";

export class BaseStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly appSecurityGroup: ec2.SecurityGroup;
  readonly db: rds.DatabaseCluster;
  readonly appDbSecret: secrets.Secret;
  readonly appSecrets: secrets.Secret;
  readonly cluster: ecs.Cluster;
  readonly toolsImage: ecs.ContainerImage;

  /** Fixed rather than looked up, so synthesis needs no AWS credentials. */
  override get availabilityZones(): string[] {
    return [`${this.region}a`, `${this.region}b`];
  }

  constructor(scope: Construct, id: string, cfg: DeployConfig, props?: StackProps) {
    super(scope, id, props);

    // Two AZs; public subnets for tasks and the balancer, isolated ones for the
    // database. No NAT gateways: tasks get public IPs behind a security group
    // that admits only the balancer, which saves ~$65/month of NAT for no loss.
    this.vpc = new ec2.Vpc(this, "Vpc", {
      // Named rather than looked up, so synthesis needs no AWS credentials.
      availabilityZones: [`${cfg.region}a`, `${cfg.region}b`],
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "db", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    this.appSecurityGroup = new ec2.SecurityGroup(this, "AppSg", {
      vpc: this.vpc,
      description: "Zuuvy Sites deploy-time migration task",
    });
    const dbSg = new ec2.SecurityGroup(this, "DbSg", { vpc: this.vpc, description: "Zuuvy Sites database" });
    // Any task in the VPC may try to connect; it still needs a password and TLS.
    // (A security-group reference would tie this stack to the services stack's
    // groups in a cycle, and the database sits in subnets with no internet route.)
    dbSg.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(5432), "Postgres from inside the VPC");

    // TLS is mandatory at the server, not just requested by the client.
    const params = new rds.ParameterGroup(this, "DbParams", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_6 }),
      parameters: { "rds.force_ssl": "1" },
    });

    this.db = new rds.DatabaseCluster(this, "Db", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_6 }),
      credentials: rds.Credentials.fromGeneratedSecret(DB_ADMIN_USER, { secretName: "zsite/db-admin" }),
      defaultDatabaseName: DB_NAME,
      writer: rds.ClusterInstance.serverlessV2("writer"),
      serverlessV2MinCapacity: cfg.dbMinAcu,
      serverlessV2MaxCapacity: cfg.dbMaxAcu,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      parameterGroup: params,
      storageEncrypted: true,
      backup: { retention: Duration.days(7) },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
    });

    // The application's own login (Row-Level Security binds it; see 0001_init.sql).
    this.appDbSecret = new secrets.Secret(this, "AppDbSecret", {
      secretName: "zsite/db-app",
      description: "Password for the zsite_app database role",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "zsite_app" }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 40,
      },
    });

    // Seals integration credentials at rest (packages/platform/src/secrets.ts).
    // Rotating it means re-sealing stored credentials, so it is never rotated automatically.
    this.appSecrets = new secrets.Secret(this, "AppSecrets", {
      secretName: "zsite/app",
      description: "Zuuvy Sites application secrets",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: "SECRETS_KEY",
        excludePunctuation: true,
        passwordLength: 48,
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.cluster = new ecs.Cluster(this, "Cluster", { vpc: this.vpc, clusterName: "zsite" });

    this.toolsImage = ecs.ContainerImage.fromAsset(REPO_ROOT, {
      file: "infra/docker/tools.Dockerfile",
      platform: ecrAssets.Platform.LINUX_AMD64,
      ignoreMode: IgnoreMode.DOCKER,
    });

    const migrateLogs = new logs.LogGroup(this, "MigrateLogs", { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY });
    const migrate = new ecs.FargateTaskDefinition(this, "MigrateTask", { cpu: 512, memoryLimitMiB: 1024 });
    migrate.addContainer("migrate", {
      image: this.toolsImage,
      command: ["npx", "tsx", "scripts/deploy-migrate.ts"],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "migrate", logGroup: migrateLogs }),
      environment: {
        DB_HOST: this.db.clusterEndpoint.hostname,
        DB_PORT: String(this.db.clusterEndpoint.port),
        DB_NAME,
        DB_SSL: "1",
        DB_ADMIN_USER,
      },
      secrets: {
        DB_ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(this.db.secret!, "password"),
        DB_APP_PASSWORD: ecs.Secret.fromSecretsManager(this.appDbSecret, "password"),
      },
    });

    // What the pipeline needs to run the migration task.
    new CfnOutput(this, "ClusterName", { value: this.cluster.clusterName });
    new CfnOutput(this, "MigrateTaskDefinitionArn", { value: migrate.taskDefinitionArn });
    new CfnOutput(this, "MigrateSubnets", { value: this.vpc.publicSubnets.map((s) => s.subnetId).join(",") });
    new CfnOutput(this, "MigrateSecurityGroup", { value: this.appSecurityGroup.securityGroupId });
    new CfnOutput(this, "MigrateLogGroup", { value: migrateLogs.logGroupName });
  }
}
