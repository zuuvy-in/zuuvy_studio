/**
 * The site-building agent. Given a site tree and a request ("make it feel
 * premium", "add an FAQ about delivery"), Claude edits the tree through the
 * tools in `tools.ts` and ends with a one-line summary. The caller saves the
 * result as a new, unpublished version — nothing the agent does reaches a
 * live site without a person pressing Publish.
 */
import Anthropic from "@anthropic-ai/sdk";
import { BLOCKS, type Operation, type SiteTree } from "@zsite/core";
import { z } from "zod";
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
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; requests: number };
  stopReason: string | null;
};

export class AgentError extends Error {
  override name = "AgentError";
}

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
  client?: Anthropic;
  model?: string;
  maxIterations?: number;
};

export async function editSite(opts: EditOptions): Promise<EditResult> {
  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? "claude-opus-5";
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

  const runner = client.beta.messages.toolRunner({
    model,
    max_tokens: 16000,
    max_iterations: opts.maxIterations ?? 30,
    // A policy decline on the primary model is retried on a fallback server-side.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools,
    messages: [{ role: "user", content: user }],
  });

  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, requests: 0 };
  let last: Anthropic.Beta.BetaMessage | null = null;
  try {
    for await (const message of runner) {
      last = message;
      usage.requests++;
      usage.input_tokens += message.usage.input_tokens;
      usage.output_tokens += message.usage.output_tokens;
      usage.cache_read_input_tokens += message.usage.cache_read_input_tokens ?? 0;
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AgentError("The AI service rejected the API key. Set ANTHROPIC_API_KEY.");
    if (e instanceof Anthropic.RateLimitError) throw new AgentError("The AI service is busy. Try again in a minute.");
    if (e instanceof Anthropic.APIError) throw new AgentError(`The AI service failed (${e.status}): ${e.message}`);
    throw e;
  }

  if (!last) throw new AgentError("The AI returned nothing.");
  if (last.stop_reason === "refusal") throw new AgentError("The AI declined this request. Try rephrasing it.");
  if (!state.operations.length) {
    const said = textOf(last);
    throw new AgentError(said ? `The AI made no changes: ${said}` : "The AI made no changes.");
  }
  return {
    tree: state.tree,
    operations: state.operations,
    summary: textOf(last).slice(0, 300) || `${state.operations.length} changes`,
    model: last.model,
    usage,
    stopReason: last.stop_reason,
  };
}

function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text.trim())
    .join(" ")
    .trim();
}

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
