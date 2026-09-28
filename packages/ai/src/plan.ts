/**
 * A plan before a build. From a request as short as "a site for my bakery in
 * Patna", the model says what it would build — pages, sections, look, the
 * assumptions it made — and asks at most a few questions that would change
 * the result. Nothing is edited: the owner approves the plan (with notes, or
 * answers), and the approved plan then goes to `editSite` with the request.
 *
 * The planner sees exactly what the builder will (describeRequest), plus the
 * design kit and reference fetching, so its plan is one the builder can carry out.
 */
import { z } from "zod";
import {
  DEFAULT_MODELS,
  type EditOptions,
  type ProviderName,
  describeRequest,
  resolveProvider,
  usesDataTools,
} from "./agent";
import { AgentError } from "./errors";
import { type McpConnection, connectMcp } from "./mcp/client";
import { anthropicProvider } from "./providers/anthropic";
import { bedrockProvider } from "./providers/bedrock";
import { type Usage, emptyUsage } from "./providers/types";
import { type SiteTool, ToolInputError, createSiteTools } from "./tools";

export const SitePlan = z.object({
  summary: z.string().min(10).max(600).describe("Two or three sentences: what you will build or change, for whom, and the feel"),
  assumptions: z
    .array(z.string().max(200))
    .max(8)
    .describe("What you assumed because the request did not say: audience, location, offer, tone. The owner corrects these."),
  pages: z
    .array(
      z.object({
        path: z.string().max(60).describe('"/" for home, "/about" …'),
        title: z.string().max(60),
        sections: z.array(z.string().max(200)).min(1).max(14).describe('One line per section, in order: "hero — …", "features — …"; mark "(new)" or "(changed)" when editing'),
      }),
    )
    .min(1)
    .max(8)
    .describe("Every page after the change, including ones that stay as they are"),
  style: z.object({
    mood: z.string().max(120).describe("In a few words"),
    colors: z.string().max(200).describe("The palette in words and hex, or 'keep the brand kit'"),
    fonts: z.string().max(80),
    motion: z.enum(["none", "subtle", "lively"]),
  }),
  imagery: z.string().max(300).describe("What pictures, from where (media library, stock photos, generated) and where they go"),
  questions: z
    .array(z.string().max(200))
    .max(3)
    .describe("Only questions whose answer would change the build a lot and that you cannot reasonably assume. Usually none."),
});
export type SitePlan = z.infer<typeof SitePlan>;

export type PlanResult = { plan: SitePlan; model: string; provider: ProviderName; usage: Usage };

const PLAN_SYSTEM = `You plan website changes for Zuuvy Sites, a website platform for small businesses in India, before anything is built. The owner reads your plan, corrects it or answers your questions, and approves it; then a builder carries it out with the same blocks and tools.

Requests are often one short line. Plan like a senior web designer given a one-line brief: decide the audience, the pages, the sections in order, the look and the copy direction yourself, and write down what you assumed. Make it a complete, ambitious plan for a real business — not a skeleton — but only what this site's blocks can do: hero, features, productGrid, richText, imageText, gallery, testimonials, stats, faq, cta, contact, and collection (portfolio data). For a store, product grids fill from the catalogue; never plan to type products or prices.

Use the design helpers (palette, font_pairings, style_recipe, search_photos) and fetch_reference when the request names a website, so the plan's colours, fonts and imagery are real choices. Respect the brand kit: what it fixes is not yours to change.

Do not invent facts that matter (phone numbers, addresses, prices, awards, years in business); note them as assumptions or questions instead. Ask a question only when the answer would change the build a lot and cannot be assumed — usually ask none.

Call submit_plan exactly once with the finished plan, then reply "Plan ready."`;

export type PlanOptions = Omit<EditOptions, "fallbackModel"> & { fallbackModel?: string };

export async function planSite(opts: PlanOptions): Promise<PlanResult> {
  const provider = opts.provider ?? resolveProvider(process.env.ZSITE_AI_PROVIDER);
  let model = opts.model || DEFAULT_MODELS[provider];
  const fallback = opts.fallbackModel ?? (model !== DEFAULT_MODELS[provider] ? DEFAULT_MODELS[provider] : "");
  const run = opts.runner ?? (provider === "anthropic" ? anthropicProvider() : bedrockProvider(opts.bedrock));
  const dataTools = usesDataTools(opts.tree, opts.context.siteKind);

  // A holder, not a `let`: the tool sets it from inside the provider's loop.
  const got: { plan?: SitePlan } = {};
  const submit: SiteTool = {
    name: "submit_plan",
    description: "Hand the finished plan to the owner. Call once, at the end.",
    inputSchema: SitePlan,
    run: (input) => {
      const parsed = SitePlan.safeParse(input);
      if (!parsed.success) throw new ToolInputError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      got.plan = parsed.data;
      return "Plan recorded. Reply \"Plan ready.\" and stop.";
    },
  };
  // Looking only: references, never the editing tools.
  const lookTools = createSiteTools(opts.tree, { fetchReference: opts.capabilities?.fetchReference, maxReferences: opts.capabilities?.maxReferences, dataTools: false }, {})
    .tools.filter((t) => t.name === "fetch_reference");
  const mcp: McpConnection | null = opts.mcp === false || (opts.mcp === undefined && opts.runner) ? null : await connectMcp(opts.mcp || {});
  const tools = [...lookTools, ...(mcp?.tools ?? []), submit];
  const usage = emptyUsage();
  const add = (u?: Usage) => {
    if (!u) return;
    usage.input_tokens += u.input_tokens;
    usage.output_tokens += u.output_tokens;
    usage.cache_read_input_tokens += u.cache_read_input_tokens;
    usage.requests += u.requests;
  };

  try {
    const user = describeRequest(opts, dataTools, mcp, tools);
    const once = async (u: string) => {
      try {
        const r = await run({ system: PLAN_SYSTEM, user: u, tools, model, maxIterations: opts.maxIterations ?? 10, attachments: opts.attachments });
        add(r.usage);
        return r;
      } catch (e) {
        add((e as AgentError).usage);
        if (!(e instanceof AgentError && e.unavailable) || !fallback || fallback === model) throw Object.assign(e as Error, { usage: { ...usage } });
        console.warn(`AI model ${model} unavailable for planning, using ${fallback}: ${(e as Error).message}`);
        model = fallback;
        const r = await run({ system: PLAN_SYSTEM, user: u, tools, model, maxIterations: opts.maxIterations ?? 10, attachments: opts.attachments });
        add(r.usage);
        return r;
      }
    };

    let result = await once(user);
    if (!got.plan && !result.refused) {
      result = await once(`${user}\n\nYou replied without calling submit_plan. Call submit_plan now with the complete plan.`);
    }
    if (result.refused) throw Object.assign(new AgentError("The AI declined this request. Try rephrasing it."), { usage, outcome: "refused" as const });
    if (!got.plan) throw Object.assign(new AgentError("The AI did not produce a plan. Try again, or turn off “Plan first”."), { usage, outcome: "no_change" as const });
    return { plan: got.plan, model, provider, usage };
  } finally {
    await mcp?.close();
  }
}

/** The approved plan, and the owner's notes on it, as the builder reads them. */
export function planBrief(plan: SitePlan, notes = ""): string {
  const lines = [
    "Approved plan (the owner agreed to this; build all of it):",
    plan.summary,
    plan.assumptions.length ? `Assumptions: ${plan.assumptions.join("; ")}` : "",
    ...plan.pages.map((p) => `Page ${p.path} "${p.title}":\n${p.sections.map((s) => `  - ${s}`).join("\n")}`),
    `Look: ${plan.style.mood}. Colours: ${plan.style.colors}. Fonts: ${plan.style.fonts}. Motion: ${plan.style.motion}.`,
    `Imagery: ${plan.imagery}`,
    notes.trim() ? `The owner's notes and answers (these override the plan):\n${notes.trim()}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}
