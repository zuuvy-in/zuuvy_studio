/**
 * Claude through Anthropic's API — kept as a switchable provider
 * (ZSITE_AI_PROVIDER=anthropic) for when credits or budget allow it. The
 * SDK's tool runner drives the loop; tools are the same SiteTools as every
 * other provider.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { toolJsonSchema } from "./bedrock";
import { AgentError } from "../errors";
import { type Provider, emptyUsage, isImageFormat } from "./types";

export function anthropicProvider(opts: { client?: Anthropic } = {}): Provider {
  return async ({ system, user, tools, model, maxIterations, attachments = [] }) => {
    const client = opts.client ?? new Anthropic();
    const content: Anthropic.Beta.BetaContentBlockParam[] = attachments.map((a) => {
      const data = Buffer.from(a.bytes).toString("base64");
      if (isImageFormat(a.format)) return { type: "image", source: { type: "base64", media_type: `image/${a.format}`, data } };
      if (a.format === "pdf") return { type: "document", title: a.name, source: { type: "base64", media_type: "application/pdf", data } };
      if (a.format === "txt" || a.format === "md" || a.format === "csv" || a.format === "html") {
        return { type: "document", title: a.name, source: { type: "text", media_type: "text/plain", data: new TextDecoder().decode(a.bytes) } };
      }
      throw new AgentError(`${a.name}: Word and Excel files need the Bedrock provider. Save it as PDF or CSV instead.`);
    });
    const runner = client.beta.messages.toolRunner({
      model,
      max_tokens: 16000,
      max_iterations: maxIterations,
      // A policy decline on the primary model is retried on a fallback server-side.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: tools.map((t) =>
        t.jsonSchema
          ? betaTool({ name: t.name, description: t.description, inputSchema: toolJsonSchema(t) as { type: "object" }, run: (input) => t.run(input) })
          : betaZodTool({ name: t.name, description: t.description, inputSchema: t.inputSchema, run: (input) => t.run(input) }),
      ),
      messages: [{ role: "user", content: [...content, { type: "text", text: user }] }],
    });

    const usage = emptyUsage();
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
      if (e instanceof AgentError) throw Object.assign(e, { usage: { ...usage } });
      if (e instanceof Anthropic.AuthenticationError) throw new AgentError("The AI service rejected the API key. Set ANTHROPIC_API_KEY.");
      if (e instanceof Anthropic.RateLimitError) throw new AgentError("The AI service is busy. Try again in a minute.");
      if (e instanceof Anthropic.NotFoundError || e instanceof Anthropic.PermissionDeniedError) {
        throw Object.assign(new AgentError(`${model} is not available to this API key: ${e.message}`), { unavailable: true, usage: { ...usage } });
      }
      if (e instanceof Anthropic.APIError) throw new AgentError(`The AI service failed (${e.status}): ${e.message}`);
      throw e;
    }
    if (!last) throw new AgentError("The AI returned nothing.");
    const finalText = last.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text.trim())
      .join(" ")
      .trim();
    return { finalText, model: last.model, usage, stopReason: last.stop_reason, refused: last.stop_reason === "refusal" };
  };
}
