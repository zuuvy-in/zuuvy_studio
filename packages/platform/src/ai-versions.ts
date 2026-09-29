/**
 * "Describe a change" → a new, unpublished version. The agent runs outside
 * any database transaction (it can take a minute); the version is written
 * afterwards, parented on the version the person was looking at.
 *
 * Around the agent:
 *   - the brand kit: fixed values are handed to the tools as locked, and
 *     applied again over the result, so no AI edit can change them;
 *   - the media library, image generation and reference fetching;
 *   - usage: every attempt is recorded with its tokens, including the ones
 *     that end in an error, because those tokens were spent too.
 */
import {
  AgentError,
  type Attachment,
  type EditResult,
  type PlanResult,
  SitePlan,
  type ToolCapabilities,
  editSite,
  parseMcpServers,
  planBrief,
  planSite,
} from "@zsite/ai";
import { type DataOp, applyBrand, applyDataOps, brandBrief, lockedThemeFields, paletteForImages } from "@zsite/core";
import { productCategories } from "./catalog";
import { config } from "./config";
import { UserError, withTenant } from "./db";
import { getIntegration } from "./integrations";
import { generateAsset, generatedImage, imageGenerationEnabled, imagesAvailable, importImage, listAssets } from "./media";
import { fetchReference } from "./references";
import { createVersion, getSite, getVersion, getVersionByNumber, latestVersion, recordAiColors } from "./sites";
import { applyTableOps, listSiteTables } from "./tables";
import { recordUsage } from "./usage";

export type GenerateInput = {
  siteId: string;
  baseVersionId: string;
  prompt: string;
  userId: string;
  attachments?: Attachment[];
  /** A plan the owner approved (planVersion), and their notes on it. */
  plan?: SitePlan;
  planNotes?: string;
};

/** Swappable for tests: anything with editSite's signature. */
export type Editor = typeof editSite;

export type GenerateOptions = {
  editor?: Editor;
  /** Override the platform's capabilities (tests); default: whatever this server supports. */
  capabilities?: ToolCapabilities;
};

/** The site, the base version and everything the model is told about the business. */
async function prepare(tenantId: string, input: Omit<GenerateInput, "prompt"> & { prompt: string }, extra?: ToolCapabilities) {
  const prompt = input.prompt.trim();
  if (prompt.length < 3) throw new UserError("Describe the change you want.");
  if (prompt.length > 4000) throw new UserError("Keep the request under 4,000 characters.");

  const { base, context, brand, tables } = await withTenant(tenantId, async (tx) => {
    const site = await getSite(tx, input.siteId);
    const base = await getVersion(tx, input.siteId, input.baseVersionId);
    if (!base.tree) throw new UserError("AI edits work on managed versions; this one is code.");
    const tenant = await tx.get<{ name: string }>("select name from tenants where id = app_tenant()");
    const categories = await productCategories(tx);
    const zuuvy = await getIntegration(tx, "zuuvy");
    const media = await listAssets(tx, 30);
    const tables = await listSiteTables(tx, input.siteId);
    return {
      base,
      tables,
      brand: site.brand,
      context: {
        businessName: tenant.name,
        siteKind: site.kind,
        categories,
        productCount: categories.reduce((n, c) => n + c.count, 0),
        catalogueSource: zuuvy && zuuvy.status !== "disconnected" ? "Zuuvy" : null,
        media: media.map((m) => ({ url: m.url, alt: m.alt, kind: m.kind })),
      },
    };
  });

  const capabilities: ToolCapabilities = {
    lockedTheme: lockedThemeFields(brand),
    imagePalette: paletteForImages(base.tree, brand),
    ...(imageGenerationEnabled()
      ? {
          generateImage: async (req) =>
            generatedImage(await generateAsset(tenantId, { ...req, siteId: input.siteId, userId: input.userId })),
          maxImages: 4,
        }
      : {}),
    ...(imagesAvailable()
      ? {
          importImage: async (req) => ({
            url: (await importImage(tenantId, { ...req, siteId: input.siteId, userId: input.userId })).url,
          }),
        }
      : {}),
    fetchReference,
    maxReferences: 3,
    tables: tables.map((t) => ({ key: t.key, name: t.name, columns: t.columns, rows: t.rows ?? 0 })),
    ...extra,
  };

  const provider = config.aiProvider();
  const shared = {
    tree: base.tree!,
    context,
    provider,
    model: config.aiModel() || undefined,
    attachments: input.attachments,
    brand: brandBrief(brand),
    capabilities,
    data: base.data,
    fallbackModel: config.aiFallbackModel(),
    mcp: {
      designKit: { unsplashKey: config.unsplashKey() || undefined, pexelsKey: config.pexelsKey() || undefined },
      servers: parseMcpServers(config.mcpServers()),
    },
  };
  const record = (r: Parameters<typeof recordUsage>[1]) =>
    withTenant(tenantId, (tx) => recordUsage(tx, r)).catch((e) => console.error("ai usage not recorded:", e));
  return { prompt, base, brand, provider, shared, record };
}

export async function generateVersion(
  tenantId: string,
  input: GenerateInput,
  optsOrEditor: GenerateOptions | Editor = {},
): Promise<{ id: string; number: number; result: EditResult }> {
  const opts: GenerateOptions = typeof optsOrEditor === "function" ? { editor: optsOrEditor } : optsOrEditor;
  const editor = opts.editor ?? editSite;
  const { prompt, base, brand, provider, shared, record } = await prepare(tenantId, input, opts.capabilities);
  // An approved plan travels with the request; the version remembers the request itself.
  const brief = input.plan ? `${prompt}\n\n${planBrief(input.plan, input.planNotes)}` : prompt;

  let result: EditResult;
  try {
    result = await editor({ ...shared, prompt: brief });
  } catch (e) {
    const err = e as AgentError;
    await record({
      userId: input.userId,
      siteId: input.siteId,
      provider,
      model: config.aiModel() || "(default)",
      inputTokens: err.usage?.input_tokens ?? 0,
      outputTokens: err.usage?.output_tokens ?? 0,
      cacheReadTokens: err.usage?.cache_read_input_tokens ?? 0,
      requests: err.usage?.requests ?? 0,
      images: err.images ?? 0,
      outcome: err instanceof AgentError && err.outcome ? err.outcome : "error",
      error: err.message,
    });
    if (e instanceof AgentError) throw new UserError(e.message);
    throw e;
  }

  // The guarantee behind "the AI never changes what the owner fixed".
  const tree = applyBrand(result.tree, brand);

  const created = await withTenant(tenantId, async (tx) => {
    const v = await createVersion(tx, input.siteId, {
      tree,
      data: result.data ?? base.data,
      parentId: base.id,
      source: "ai",
      prompt,
      summary: result.summary,
      aiMeta: {
        provider: result.provider,
        model: result.model,
        operations: result.operations.length,
        usage: result.usage,
        images: result.images ?? 0,
        attachments: input.attachments?.map((a) => a.name) ?? [],
        dataOperations: result.dataOperations?.length ?? 0,
        // Held for the owner: applied only when they allow them (applyProposals).
        proposals: result.proposals ?? [],
        // Tables the AI asked to delete: the owner decides (deleteProposedTable).
        tableDeletes: result.tableDeletes ?? [],
      },
      userId: input.userId,
    });
    await recordAiColors(tx, input.siteId, tree);
    // Tables the forms need exist the moment the version does; nothing is created by a run that failed.
    if (result.tableOps?.length) await applyTableOps(tx, input.siteId, result.tableOps);
    await recordUsage(tx, {
      userId: input.userId,
      siteId: input.siteId,
      versionId: v.id,
      provider: result.provider,
      model: result.model,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      cacheReadTokens: result.usage.cache_read_input_tokens,
      requests: result.usage.requests,
      images: result.images ?? 0,
      outcome: "version",
    });
    return v;
  });
  return { ...created, result: { ...result, tree } };
}

export type StoredProposal = { op: DataOp; description: string };

/**
 * The owner allowed some of the AI's proposed changes to existing data:
 * apply those to the version they were proposed on and save the result as a
 * new version. The version they came from is untouched — it stays the backup.
 */
export async function applyProposals(
  tenantId: string,
  siteId: string,
  versionNumber: number,
  indices: number[],
  userId: string,
): Promise<{ id: string; number: number }> {
  return withTenant(tenantId, async (tx) => {
    const from = await getVersionByNumber(tx, siteId, versionNumber);
    const proposals = ((from.ai_meta as { proposals?: StoredProposal[] } | null)?.proposals ?? []).filter((_, i) => indices.includes(i));
    if (!proposals.length) throw new UserError("Choose at least one change to allow.");
    const head = await latestVersion(tx, siteId);
    // On top of the latest data, so work done since the proposal is kept.
    let data;
    try {
      data = applyDataOps(head.data, proposals.map((p) => p.op));
    } catch (e) {
      throw new UserError(`These changes no longer fit the current data (${(e as Error).message}). Ask the AI again.`);
    }
    const allowed = new Set(indices);
    return createVersion(tx, siteId, {
      tree: head.tree!,
      data,
      parentId: head.id,
      source: "ai",
      prompt: from.prompt,
      summary: `Applied changes you allowed from version ${from.number}: ${proposals.map((p) => p.description).join("; ")}`.slice(0, 300),
      aiMeta: { appliedFrom: from.number, applied: [...allowed] },
      userId,
    });
  });
}

/** Swappable for tests: anything with planSite's signature. */
export type Planner = typeof planSite;

/**
 * "Plan first": the AI says what it would build from the request — nothing
 * is edited and no version is made. The owner approves the plan (with notes)
 * and generateVersion builds it. Metered like an edit.
 */
export async function planVersion(tenantId: string, input: GenerateInput, opts: { planner?: Planner; capabilities?: ToolCapabilities } = {}): Promise<PlanResult> {
  const planner = opts.planner ?? planSite;
  const { prompt, shared, record } = await prepare(tenantId, input, opts.capabilities);
  const base = { userId: input.userId, siteId: input.siteId, images: 0 };
  try {
    const r = await planner({ ...shared, prompt });
    await record({
      ...base,
      provider: r.provider,
      model: r.model,
      inputTokens: r.usage.input_tokens,
      outputTokens: r.usage.output_tokens,
      cacheReadTokens: r.usage.cache_read_input_tokens,
      requests: r.usage.requests,
      outcome: "plan",
    });
    return r;
  } catch (e) {
    const err = e as AgentError;
    await record({
      ...base,
      provider: shared.provider,
      model: shared.model || "(default)",
      inputTokens: err.usage?.input_tokens ?? 0,
      outputTokens: err.usage?.output_tokens ?? 0,
      cacheReadTokens: err.usage?.cache_read_input_tokens ?? 0,
      requests: err.usage?.requests ?? 0,
      outcome: err instanceof AgentError && err.outcome ? err.outcome : "error",
      error: err.message,
    });
    if (e instanceof AgentError) throw new UserError(e.message);
    throw e;
  }
}

/** A plan that came back from the browser: parsed again, never trusted. */
export function parsePlan(raw: string): SitePlan {
  try {
    return SitePlan.parse(JSON.parse(raw));
  } catch {
    throw new UserError("That plan could not be read. Make a new one.");
  }
}

/** The plan's shape, for the studio (which does not depend on @zsite/ai). */
export type Plan = SitePlan;
