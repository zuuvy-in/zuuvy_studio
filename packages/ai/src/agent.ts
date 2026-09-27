/**
 * The site-building agent. Given a site tree and a request ("make it feel
 * premium", "add an FAQ about delivery"), a model edits the tree through the
 * tools in `tools.ts` and ends with a one-line summary. The caller saves the
 * result as a new, unpublished version — nothing the agent does reaches a
 * live site without a person pressing Publish.
 *
 * Which model does the work is a provider choice (`providers/`):
 *   bedrock   (default) Amazon Nova via the Bedrock Converse API — covered by AWS credits
 *   anthropic Claude via Anthropic's API
 * The prompt, the tools and every validation rule are the same for both.
 */
import { BLOCKS, type Operation, type SiteTree } from "@zsite/core";
import { z } from "zod";
import { AgentError } from "./errors";
import { anthropicProvider } from "./providers/anthropic";
import { type BedrockOptions, bedrockProvider } from "./providers/bedrock";
import type { Provider, Usage } from "./providers/types";
import { createSiteTools, outline } from "./tools";

export type SiteContext = {
  businessName: string;
  siteKind: "landing" | "portfolio" | "store";
  /** Categories in the connected catalogue, for product grids. */
  categories: { category: string; count: number }[];
  productCount: number;
  catalogueSource: string | null;
};

export type EditResult = {
  tree: SiteTree;
  operations: Operation[];
  summary: string;
  model: string;
  provider: ProviderName;
  usage: Usage;
  stopReason: string | null;
};

export { AgentError };

export type ProviderName = "bedrock" | "anthropic";

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  // Cross-region inference profile for Asia Pacific (the Mumbai region routes through it).
  // Override with ZSITE_AI_MODEL, e.g. "us.amazon.nova-premier-v1:0" in us-east-1.
  bedrock: "apac.amazon.nova-pro-v1:0",
  anthropic: "claude-opus-5",
};

function blockReference(): string {
  return Object.entries(BLOCKS)
    .map(([type, schema]) => `### ${type}\n${JSON.stringify(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }))}`)
    .join("\n\n");
}

// Built once: identical bytes on every request keep the tools + system prefix cacheable.
const SYSTEM = `You are the site builder inside Zuuvy Sites, a website platform for small businesses in India. You edit one website by calling tools. Each tool applies one change to the site tree and validates it; if a call fails, read the error, fix the input and try again.

How a site is built:
- A site has pages; a page has sections; each section is one block with props. The blocks and their prop schemas are listed below — use nothing else.
- Refer to pages by path ("/", "/about") or id, and to sections by id. Ids of things you add come back in the tool result.
- Product grids fill themselves from the connected catalogue. Never type products, prices or stock into other blocks; to feature a category, set a productGrid's \`category\` to one of the catalogue's categories exactly as given.
- Links are "/path", "/#section-id", https://, mailto: or tel:. Anchor links point at section ids.
- Images must be https URLs the user gave you. Otherwise leave image fields out; the site shows a tasteful placeholder.

How to work:
- Do what was asked, completely, and nothing unrelated. Keep what the user did not ask to change.
- Write real, specific copy for this business in plain English (Indian English spelling), short sentences. Do not invent facts that matter: phone numbers, addresses, prices, years in business, awards, customer names. When a block needs such a fact and you do not have it, write copy that does not need it, or leave the optional field out.
- Keep the design coherent: a palette with enough contrast (text on background and on surface must stay readable), at most two fonts, consistent tone.
- Make all the calls you need, then reply with one sentence (under 25 words) saying what you changed, for the version history. Do not ask questions; if the request is ambiguous, choose the most reasonable reading.

## Blocks

${blockReference()}`;

export type EditOptions = {
  tree: SiteTree;
  prompt: string;
  context: SiteContext;
  provider?: ProviderName;
  model?: string;
  maxIterations?: number;
  /** Supply a ready provider (tests); otherwise one is built from `provider`. */
  runner?: Provider;
  bedrock?: BedrockOptions;
};

export function resolveProvider(name: string | undefined): ProviderName {
  return name === "anthropic" ? "anthropic" : "bedrock";
}

export async function editSite(opts: EditOptions): Promise<EditResult> {
  const provider = opts.provider ?? resolveProvider(process.env.ZSITE_AI_PROVIDER);
  const model = opts.model || DEFAULT_MODELS[provider];
  const run = opts.runner ?? (provider === "anthropic" ? anthropicProvider() : bedrockProvider(opts.bedrock));
  const { tools, state } = createSiteTools(opts.tree);
  const ctx = opts.context;

  const facts = [
    `Business: ${ctx.businessName}`,
    `Kind of site: ${ctx.siteKind}`,
    ctx.catalogueSource
      ? `Catalogue: ${ctx.productCount} products from ${ctx.catalogueSource}. Categories: ${
          ctx.categories.map((c) => `${c.category} (${c.count})`).join(", ") || "none"
        }`
      : "Catalogue: none connected (product grids will be empty until one is).",
  ].join("\n");

  const user = `${facts}

Current site outline:
${outline(opts.tree)}

Current site tree:
${JSON.stringify(opts.tree)}

Request:
${opts.prompt}`;

  const result = await run({ system: SYSTEM, user, tools, model, maxIterations: opts.maxIterations ?? 30 });

  if (result.refused) throw new AgentError("The AI declined this request. Try rephrasing it.");
  if (!state.operations.length) {
    throw new AgentError(result.finalText ? `The AI made no changes: ${result.finalText.slice(0, 300)}` : "The AI made no changes.");
  }
  return {
    tree: state.tree,
    operations: state.operations,
    summary: result.finalText.slice(0, 300) || `${state.operations.length} changes`,
    model: result.model,
    provider,
    usage: result.usage,
    stopReason: result.stopReason,
  };
}

/** Whether the configured provider has what it needs to be tried at all. */
export function aiConfigured(): boolean {
  const provider = resolveProvider(process.env.ZSITE_AI_PROVIDER);
  if (provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  // Credentials resolve lazily through the AWS chain (keys, profile, role); a region is the one thing we can check.
  return Boolean(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION);
}
