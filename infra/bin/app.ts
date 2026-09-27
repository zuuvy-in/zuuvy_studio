/**
 * Zuuvy Sites on AWS. Two stacks, deployed in order by the pipeline with the
 * database migration between them:
 *
 *   ZsiteBase      network, Aurora PostgreSQL, secrets, ECS cluster, migrate task
 *   ZsiteServices  load balancer, certificate, DNS, studio/renderer/worker services
 */
import { App, Tags } from "aws-cdk-lib";
import { BaseStack } from "../lib/base-stack";
import { loadConfig } from "../lib/config";
import { ServicesStack } from "../lib/services-stack";

const cfg = loadConfig();
const app = new App();
const env = { account: cfg.account, region: cfg.region };

const base = new BaseStack(app, "ZsiteBase", cfg, { env, description: "Zuuvy Sites — network, database, secrets" });
const services = new ServicesStack(app, "ZsiteServices", { env, base, cfg, description: "Zuuvy Sites — load balancer and services" });
services.addStackDependency(base);

Tags.of(app).add("project", "zuuvy-sites");
