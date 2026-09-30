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
import { ICONS8_GUIDE, skillsForPrompt } from "./skills";
import { anthropicProvider } from "./providers/anthropic";
import { type BedrockOptions, bedrockProvider } from "./providers/bedrock";
import { type McpConnection, type McpOptions, connectMcp } from "./mcp/client";
import type { Attachment, Provider, ProviderResult, Usage } from "./providers/types";
import { type Proposal, type TableOpSpec, type ToolCapabilities, createSiteTools, outline } from "./tools";

export type SiteContext = {
  businessName: string;
  siteKind: "landing" | "portfolio" | "store";
  /** Visitors can sign in here (always true for a store). */
  accounts?: boolean;
  /** Categories in the connected catalogue, for product grids. */
  categories: { category: string; count: number }[];
  productCount: number;
  catalogueSource: string | null;
  /** The business's media library: pictures the AI may place without generating new ones. */
  media?: { url: string; alt: string; kind: "upload" | "generated" }[];
  /** The site's locked icon family and illustration style, from its theme. */
  iconPack?: string;
  illustrationStyle?: string;
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
  /** Tables to create or change with this version. */
  tableOps?: TableOpSpec[];
  /** Tables the AI asked to delete, held for the owner. */
  tableDeletes?: { key: string; reason: string }[];
  stopReason: string | null;
  /** Set when the requested model could not be used and the fallback model did the edit. */
  fellBack?: string;
};

export { AgentError };

export type ProviderName = "bedrock" | "anthropic";

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  // Cross-region inference profile for Asia Pacific (the Mumbai region routes through it).
  // Override with ZSITE_AI_MODEL: any Bedrock model with tool use, e.g.
  // "global.anthropic.claude-opus-5" (Claude on Bedrock, through the same Converse loop).
  // It is also the fallback when a configured model cannot be used.
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
- Images must be https URLs, and never invented. Sources, in order: the owner's own pictures (the media library listed with the request) for their products, premises and people; real photography from design__search_photos (Unsplash — use each URL exactly as given and credit the photographer); illustrations and icons from the Icons8 tools when they are listed (save illustrations with save_image first — their links expire); generate_image only if it is listed. Follow the imagery skill: photos for real things, illustrations for ideas and empty states, never both styles mixed in one row. If no source fits, leave the image field out and the site shows a tasteful placeholder. A failed picture is never a reason to change nothing.
- Portfolio sites keep structured content in data collections (profile, projects, experience, education, skills, services, testimonials, awards, publications, clients, gallery), not in section props; a "collection" section shows one of them. Only use collections when the request's facts say "Data collections: available". Portfolios should be built this way: put the facts in the data, then show them with collection sections. Use the data tools (view_data, add_entry, update_entry, remove_entry, move_entry).
- The owner's data is theirs. Adding entries and filling empty fields is fine. Changing a value that is already there, removing an entry, or replacing the profile is held for the owner's permission automatically — do not try to get round it; say in your summary what you proposed. Never invent facts for the data (employers, clients, dates, awards, quotes); use what the owner gave you, attached files included.
- A store's cart, checkout and customer account — and the account of any site with sign-in — are part of the design: decide them with set_commerce (where the cart and account sit and how they are drawn — icon, word, button or pill, matched to the header; which buy buttons; checkout layout; and the sign-in, account, cart and thank-you pages' layout, frame and wording in the site's voice). When you build or restyle such a site, set them to suit it. Those pages are drawn by the platform from these settings — never build them as sections. A site that sells nothing has no cart: never add cart, basket or checkout links to it.
- Replacing a section: add the new section first (after the old one), and remove the old one only once the new one is on the page. Never finish a turn having removed something you were asked to replace or improve without its replacement in place; if you cannot build the replacement, leave the original and say why.
- Forms (contact, enquiry, booking, quote, sign-up) are form blocks. To keep the answers, create_table first (one column per field, same keys) and point the form's destination at it; to hand the visitor to another page (a sign-up or booking system), use destination url and the answers go as URL parameters. A short single choice (2–6 options) reads best as a "pills" field, a long list as "select"; a field's "value" fills it in or preselects an option. Tabular content (prices, timings, specs, comparisons) is a table block. Never write HTML or markdown into any text.
- Motion is a theme setting (set_theme motion: none, subtle or lively). Use it when the request asks for animation or a livelier feel.
- When the request names a website as a reference and fetch_reference is available, look at it first, then build in that spirit for this business: its structure, tone and palette, never its words, images or name.

How to work:
- Requests are often one short line ("a site for my bakery in Patna", "make it look premium"). Treat one as a brief to a senior web designer: decide the audience, structure, style and copy yourself and deliver a finished, polished result — every section filled with real copy, pictures where they help, a coherent theme — never a skeleton. For a new site, or one still showing its template's copy, build every page and section a business of this kind needs.
- When the request includes an approved plan, follow it: the owner agreed to it. Their notes on it override the plan.
- Do what was asked, completely, and nothing unrelated. Keep what the user did not ask to change.
- Write real, specific copy for this business in plain English (Indian English spelling), short sentences. Do not invent facts that matter: phone numbers, addresses, prices, years in business, awards, customer names. When a block needs such a fact and you do not have it, write copy that does not need it, or leave the optional field out.
- Keep the design coherent: a palette with enough contrast (text on background and on surface must stay readable), at most two fonts, consistent tone.
- Follow the skills below (web design, content, animation). A site should look designed: varied section layouts, alternating section styles (style_section), icons on features/steps/bullets (exact Lucide names — find them with design__search_icons), and two or three moving pieces. When you build or restyle, use the richer block options, not just the defaults.
- Make all the calls you need, then reply with one sentence (under 25 words, no <thinking> tags) saying what you changed, for the version history. Do not ask questions; if the request is ambiguous, choose the most reasonable reading.

## Skills

${skillsForPrompt()}

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
  /**
   * Tried when `model` cannot be used at all (not enabled on the account,
   * refused by IAM, not in the region). Default: the provider's default model
   * when a different one was named. "" turns it off.
   */
  fallbackModel?: string;
  /** The design kit and any remote MCP servers; false for none (tests default to none). */
  mcp?: McpOptions | false;
};

export function resolveProvider(name: string | undefined): ProviderName {
  return name === "anthropic" ? "anthropic" : "bedrock";
}

/**
 * What the model is told about the business and the site, then the request.
 * Shared by editing and planning, so a plan is made from the same facts the
 * build will see.
 */
export function describeRequest(
  opts: Pick<EditOptions, "context" | "tree" | "data" | "brand" | "attachments" | "capabilities" | "prompt">,
  dataTools: boolean,
  mcp: McpConnection | null,
  tools: { name: string }[],
): string {
  const ctx = { ...opts.context, iconPack: opts.tree.theme.iconPack, illustrationStyle: opts.tree.theme.illustrationStyle };
  const facts = [
    `Business: ${ctx.businessName}`,
    `Kind of site: ${ctx.siteKind}${ctx.siteKind === "store" ? " (cart, checkout and customer accounts)" : ctx.accounts ? " (customer accounts on; no cart — it sells nothing)" : " (no cart, no accounts)"}`,
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
    opts.capabilities?.generateImage
      ? `Picture generation: available (generate_image, up to ${opts.capabilities.maxImages ?? 4} this request) — only when no photo or illustration fits.`
      : "Picture generation: off. Use photos (design__search_photos), Icons8 illustrations and icons when those tools are listed, and the media library.",
    ctx.iconPack || ctx.illustrationStyle
      ? `This site's locked styles (keep to them): ${[ctx.iconPack && `icons ${ctx.iconPack}`, ctx.illustrationStyle && `illustrations ${ctx.illustrationStyle}`].filter(Boolean).join(", ")}.`
      : "",
    tools.some((t) => t.name.startsWith("icons8__")) ? `Icons8 is connected.\n${ICONS8_GUIDE}` : "",
    opts.capabilities?.tables
      ? `Site tables (where forms store answers): ${
          opts.capabilities.tables.length ? opts.capabilities.tables.map((t) => `${t.key} [${t.columns.map((c) => c.key).join(", ")}] — ${t.rows} answers`).join("; ") : "none yet"
        }.`
      : "",
    mcp?.summary.length
      ? `Design helpers (MCP tools — call them before choosing colours, fonts, layout or photos when the request is about the look):\n${mcp.summary.map((l) => `- ${l}`).join("\n")}${
          tools.some((t) => t.name === "design__search_photos")
            ? "\nStock photos: design__search_photos returns real photos whose https URLs go straight into image fields; prefer them to generated pictures for real places, people and food."
            : ""
        }`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `${facts}

Current site outline:
${outline(opts.tree)}

Current site tree:
${JSON.stringify(opts.tree)}

${dataTools ? `Current data collections:\n${JSON.stringify(opts.data ?? {})}` : ""}

Request:
${opts.prompt}`;
}

/** Collections belong to portfolios (and to any site already showing one, so its data is not stranded). */
export function usesDataTools(tree: SiteTree, siteKind: SiteContext["siteKind"]): boolean {
  return siteKind === "portfolio" || tree.pages.some((p) => p.sections.some((s) => s.type === "collection"));
}

export async function editSite(opts: EditOptions): Promise<EditResult> {
  const provider = opts.provider ?? resolveProvider(process.env.ZSITE_AI_PROVIDER);
  let model = opts.model || DEFAULT_MODELS[provider];
  const fallback = opts.fallbackModel ?? (model !== DEFAULT_MODELS[provider] ? DEFAULT_MODELS[provider] : "");
  const run = opts.runner ?? (provider === "anthropic" ? anthropicProvider() : bedrockProvider(opts.bedrock));
  const dataTools = usesDataTools(opts.tree, opts.context.siteKind);
  const commerceTools = opts.context.siteKind === "store" ? "store" : opts.context.accounts ? "accounts" : false;
  const { tools: siteTools, state } = createSiteTools(opts.tree, { ...opts.capabilities, dataTools, commerceTools }, opts.data ?? {});
  // Runners supplied by tests get no MCP unless they ask for it.
  const mcp: McpConnection | null = opts.mcp === false || (opts.mcp === undefined && opts.runner) ? null : await connectMcp(opts.mcp || {});
  const tools = [...siteTools, ...(mcp?.tools ?? [])];
  try {
    return await edit();
  } finally {
    await mcp?.close();
  }

  async function edit(): Promise<EditResult> {
    const user = describeRequest(opts, dataTools, mcp, tools);

    // A model the account cannot use fails before it edits anything, so the
    // same request can go to the fallback model with nothing to undo.
    let fellBack = "";
    let spent: Usage | undefined;
    const attempt = async (u: string): Promise<ProviderResult> => {
      try {
        return await run({ system: SYSTEM, user: u, tools, model, maxIterations: opts.maxIterations ?? 30, attachments: opts.attachments });
      } catch (e) {
        const unusable = e instanceof AgentError && e.unavailable && !state.operations.length && !state.dataOperations.length;
        if (!unusable || !fallback || fallback === model) throw e;
        console.warn(`AI model ${model} unavailable, using ${fallback}: ${(e as Error).message}`);
        fellBack = `${model} could not be used (${(e as Error).message.slice(0, 160)}), so ${fallback} made this edit.`;
        spent = (e as AgentError).usage;
        model = fallback;
        return run({ system: SYSTEM, user: u, tools, model, maxIterations: opts.maxIterations ?? 30, attachments: opts.attachments });
      }
    };

    let result = await attempt(user);

    // A model sometimes describes edits it never made (no tool call succeeded) —
    // typically after a tool failed. Ask once more, plainly, before giving up.
    const nothingDone = () =>
      !state.operations.length && !state.dataOperations.length && !state.proposals.length && !state.tableOps.length && !state.tableDeletes.length;
    if (!result.refused && nothingDone() && result.finalText) {
      const retry = await attempt(
        `${user}\n\nYour previous attempt replied "${result.finalText.slice(0, 400)}" but made no change: no tool call succeeded, so nothing was saved. Make the requested changes now by calling the tools${state.imageError ? " (picture generation is unavailable — skip pictures, do everything else)" : ""}.`,
      );
      const u = result.usage;
      retry.usage = {
        input_tokens: u.input_tokens + retry.usage.input_tokens,
        output_tokens: u.output_tokens + retry.usage.output_tokens,
        cache_read_input_tokens: u.cache_read_input_tokens + retry.usage.cache_read_input_tokens,
        requests: u.requests + retry.usage.requests,
      };
      result = retry;
    }

    if (spent) {
      result.usage = {
        input_tokens: result.usage.input_tokens + spent.input_tokens,
        output_tokens: result.usage.output_tokens + spent.output_tokens,
        cache_read_input_tokens: result.usage.cache_read_input_tokens + spent.cache_read_input_tokens,
        requests: result.usage.requests + spent.requests,
      };
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
        (state.imageError ? " (pictures could not be generated)" : "") +
        (fellBack ? ` (made with ${model}; the configured model was unavailable)` : ""),
      model: result.model,
      provider,
      usage: result.usage,
      images: state.images,
      data: state.data,
      dataOperations: state.dataOperations,
      proposals: state.proposals,
      tableOps: state.tableOps,
      tableDeletes: state.tableDeletes,
      stopReason: result.stopReason,
      fellBack: fellBack || undefined,
    };
  }
}

/** Whether the configured provider has what it needs to be tried at all. */
export function aiConfigured(): boolean {
  const provider = resolveProvider(process.env.ZSITE_AI_PROVIDER);
  if (provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  // Credentials resolve lazily through the AWS chain (keys, profile, role); a region is the one thing we can check.
  return Boolean(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION);
}
