/**
 * "Describe a change" → a new, unpublished version. The agent runs outside
 * any database transaction (it can take a minute); the version is written
 * afterwards, parented on the version the person was looking at.
 */
import { AgentError, type EditResult, editSite } from "@zsite/ai";
import { productCategories } from "./catalog";
import { config } from "./config";
import { UserError, withTenant } from "./db";
import { getIntegration } from "./integrations";
import { createVersion, getSite, getVersion } from "./sites";

export type GenerateInput = { siteId: string; baseVersionId: string; prompt: string; userId: string };

/** Swappable for tests: anything with editSite's signature. */
export type Editor = typeof editSite;

export async function generateVersion(
  tenantId: string,
  input: GenerateInput,
  editor: Editor = editSite,
): Promise<{ id: string; number: number; result: EditResult }> {
  const prompt = input.prompt.trim();
  if (prompt.length < 3) throw new UserError("Describe the change you want.");
  if (prompt.length > 4000) throw new UserError("Keep the request under 4,000 characters.");

  const { base, context } = await withTenant(tenantId, async (tx) => {
    const site = await getSite(tx, input.siteId);
    const base = await getVersion(tx, input.siteId, input.baseVersionId);
    if (!base.tree) throw new UserError("AI edits work on managed versions; this one is code.");
    const tenant = await tx.get<{ name: string }>("select name from tenants where id = app_tenant()");
    const categories = await productCategories(tx);
    const zuuvy = await getIntegration(tx, "zuuvy");
    return {
      base,
      context: {
        businessName: tenant.name,
        siteKind: site.kind,
        categories,
        productCount: categories.reduce((n, c) => n + c.count, 0),
        catalogueSource: zuuvy && zuuvy.status !== "disconnected" ? "Zuuvy" : null,
      },
    };
  });

  let result: EditResult;
  try {
    result = await editor({ tree: base.tree!, prompt, context, model: config.aiModel() });
  } catch (e) {
    if (e instanceof AgentError) throw new UserError(e.message);
    throw e;
  }

  const created = await withTenant(tenantId, (tx) =>
    createVersion(tx, input.siteId, {
      tree: result.tree,
      parentId: base.id,
      source: "ai",
      prompt,
      summary: result.summary,
      aiMeta: { model: result.model, operations: result.operations.length, usage: result.usage },
      userId: input.userId,
    }),
  );
  return { ...created, result };
}
