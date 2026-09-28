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
import { BLOCKS, COLLECTIONS, type DataOp, type Operation, type SiteData, type SiteTree } from "@zsite/core";
import { z } from "zod";
import { AgentError } from "./errors";
import { anthropicProvider } from "./providers/anthropic";
import { type BedrockOptions, bedrockProvider } from "./providers/bedrock";
import type { Attachment, Provider, Usage } from "./providers/types";
import { type Proposal, type ToolCapabilities, createSiteTools, outline } from "./tools";

export type SiteContext = {
  businessName: string;
  siteKind: "landing" | "portfolio" | "store";
  /** Categories in the connected catalogue, for product grids. */
  categories: { category: string; count: number }[];
  productCount: number;
  catalogueSource: string | null;
  /** The business's media library: pictures the AI may place without generating new ones. */
  media?: { url: string; alt: string; kind: "upload" | "generated" }[];
};

export type EditResult = {
  tree: SiteTree;
  operations: Operation[];
  summary: string;
  model: string;
  provider: ProviderName;
  usage: Usage;
  /** Pictures generated during this edit. */
  images: number;
  /** The site's data after the edit (only changes that needed no permission). */
  data: SiteData;
  dataOperations: DataOp[];
  /** Changes to existing data held back for the owner to allow. */
  proposals: Proposal[];
  stopReason: string | null;
};

export { AgentError };

export type ProviderName = "bedrock" | "anthropic";

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  // Cross-region inference profile for Asia Pacific (the Mumbai region routes through it).
  // Override with ZSITE_AI_MODEL: any Bedrock model with tool use, e.g.
  // "global.anthropic.claude-sonnet-5" (Claude on Bedrock, through the same Converse loop).
  bedrock: "apac.amazon.nova-pro-v1:0",
  anthropic: "claude-opus-5",
};

function collectionReference(): string {
  return COLLECTIONS.map(
    (c) =>
      `### ${c.key}${c.single ? " (one record)" : ""}\n${c.description}\nFields: ${c.fields
        .map((f) => `${f.key} (${f.kind}${f.required ? ", required" : ""})`)
        .join(", ")}`,
  ).join("\n\n");
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
- Images must be https URLs: ones the user gave you, ones from the media library listed with the request, or ones generate_image returned. Prefer the business's own uploaded pictures for its products, premises and people. If generate_image is available and the request asks for pictures, illustrations or a more visual site, generate them; otherwise leave image fields out and the site shows a tasteful placeholder. Never invent an image URL. If generate_image fails, do not retry it: make every other change the request asks for, leave those image fields empty, and mention it in your summary. A failed picture is never a reason to change nothing.
- Portfolio sites keep structured content in data collections (profile, projects, experience, education, skills, services, testimonials, awards, publications, clients, gallery), not in section props; a "collection" section shows one of them. Only use collections when the request's facts say "Data collections: available". Portfolios should be built this way: put the facts in the data, then show them with collection sections. Use the data tools (view_data, add_entry, update_entry, remove_entry, move_entry).
- The owner's data is theirs. Adding entries and filling empty fields is fine. Changing a value that is already there, removing an entry, or replacing the profile is held for the owner's permission automatically — do not try to get round it; say in your summary what you proposed. Never invent facts for the data (employers, clients, dates, awards, quotes); use what the owner gave you, attached files included.
- Motion is a theme setting (set_theme motion: none, subtle or lively). Use it when the request asks for animation or a livelier feel.
- When the request names a website as a reference and fetch_reference is available, look at it first, then build in that spirit for this business: its structure, tone and palette, never its words, images or name.

How to work:
- Do what was asked, completely, and nothing unrelated. Keep what the user did not ask to change.
- Write real, specific copy for this business in plain English (Indian English spelling), short sentences. Do not invent facts that matter: phone numbers, addresses, prices, years in business, awards, customer names. When a block needs such a fact and you do not have it, write copy that does not need it, or leave the optional field out.
- Keep the design coherent: a palette with enough contrast (text on background and on surface must stay readable), at most two fonts, consistent tone.
- Make all the calls you need, then reply with one sentence (under 25 words, no <thinking> tags) saying what you changed, for the version history. Do not ask questions; if the request is ambiguous, choose the most reasonable reading.

## Blocks

${blockReference()}

## Data collections

${collectionReference()}`;

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
  /** Files attached to the request (brief, price list, screenshots), read by the model. */
  attachments?: Attachment[];
  /** Plain-language brand kit brief (see @zsite/core brandBrief). */
  brand?: string;
  /** Image generation and reference fetching, when the platform provides them. */
  capabilities?: ToolCapabilities;
  /** The base version's data collections. */
  data?: SiteData;
};

export function resolveProvider(name: string | undefined): ProviderName {
  return name === "anthropic" ? "anthropic" : "bedrock";
}

export async function editSite(opts: EditOptions): Promise<EditResult> {
  const provider = opts.provider ?? resolveProvider(process.env.ZSITE_AI_PROVIDER);
  const model = opts.model || DEFAULT_MODELS[provider];
  const run = opts.runner ?? (provider === "anthropic" ? anthropicProvider() : bedrockProvider(opts.bedrock));
  // Collections belong to portfolios (and to any site already showing one, so its data is not stranded).
  const usesCollections = opts.tree.pages.some((p) => p.sections.some((s) => s.type === "collection"));
  const dataTools = opts.context.siteKind === "portfolio" || usesCollections;
  const { tools, state } = createSiteTools(opts.tree, { ...opts.capabilities, dataTools }, opts.data ?? {});
  const ctx = opts.context;

  const facts = [
    `Business: ${ctx.businessName}`,
    `Kind of site: ${ctx.siteKind}`,
    ctx.catalogueSource
      ? `Catalogue: ${ctx.productCount} products from ${ctx.catalogueSource}. Categories: ${
          ctx.categories.map((c) => `${c.category} (${c.count})`).join(", ") || "none"
        }`
      : "Catalogue: none connected (product grids will be empty until one is).",
    ctx.media?.length
      ? `Media library (use these URLs as they are):\n${ctx.media.map((m) => `- ${m.url} — ${m.alt || "(no description)"} [${m.kind}]`).join("\n")}`
      : "Media library: empty.",
    dataTools
      ? "Data collections: available (portfolio content lives there)."
      : "Data collections: not used on this kind of site — build with ordinary blocks, never collection sections.",
    opts.brand ? `Brand kit:\n${opts.brand}` : "Brand kit: none — choose colours, fonts and imagery that fit the business.",
    opts.attachments?.length
      ? `Attached files (read them; they are the owner's material — use their facts, products, wording and look where the request asks): ${opts.attachments.map((a) => a.name).join(", ")}`
      : "",
    `Picture generation: ${opts.capabilities?.generateImage ? `available (generate_image, up to ${opts.capabilities.maxImages ?? 4} this request)` : "not available — use the media library or leave image fields out"}.`,
  ]
    .filter(Boolean)
    .join("\n");

  const user = `${facts}

Current site outline:
${outline(opts.tree)}

Current site tree:
${JSON.stringify(opts.tree)}

${dataTools ? `Current data collections:\n${JSON.stringify(opts.data ?? {})}` : ""}

Request:
${opts.prompt}`;

  let result = await run({ system: SYSTEM, user, tools, model, maxIterations: opts.maxIterations ?? 30, attachments: opts.attachments });

  // A model sometimes describes edits it never made (no tool call succeeded) —
  // typically after a tool failed. Ask once more, plainly, before giving up.
  const nothingDone = () => !state.operations.length && !state.dataOperations.length && !state.proposals.length;
  if (!result.refused && nothingDone() && result.finalText) {
    const retry = await run({
      system: SYSTEM,
      user: `${user}\n\nYour previous attempt replied "${result.finalText.slice(0, 400)}" but made no change: no tool call succeeded, so nothing was saved. Make the requested changes now by calling the tools${state.imageError ? " (picture generation is unavailable — skip pictures, do everything else)" : ""}.`,
      tools,
      model,
      maxIterations: opts.maxIterations ?? 30,
      attachments: opts.attachments,
    });
    const u = result.usage;
    retry.usage = {
      input_tokens: u.input_tokens + retry.usage.input_tokens,
      output_tokens: u.output_tokens + retry.usage.output_tokens,
      cache_read_input_tokens: u.cache_read_input_tokens + retry.usage.cache_read_input_tokens,
      requests: u.requests + retry.usage.requests,
    };
    result = retry;
  }

  const pictures = state.imageError ? ` Picture generation failed: ${state.imageError}` : "";
  const fail = (message: string, outcome: "refused" | "no_change") =>
    Object.assign(new AgentError(`${message}${pictures}`), { usage: result.usage, outcome, images: state.images });
  if (result.refused) throw fail("The AI declined this request. Try rephrasing it.", "refused");
  if (nothingDone()) {
    throw fail(result.finalText ? `The AI made no changes: ${result.finalText.slice(0, 300)}` : "The AI made no changes.", "no_change");
  }
  return {
    tree: state.tree,
    operations: state.operations,
    summary:
      (result.finalText.slice(0, 280) || `${state.operations.length + state.dataOperations.length} changes`) +
      (state.imageError ? " (pictures could not be generated)" : ""),
    model: result.model,
    provider,
    usage: result.usage,
    images: state.images,
    data: state.data,
    dataOperations: state.dataOperations,
    proposals: state.proposals,
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
