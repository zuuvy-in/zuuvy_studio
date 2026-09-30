/**
 * Amazon Bedrock through the Converse API — the default provider, running
 * Amazon Nova, which AWS promotional (startup) credits cover as a first-party
 * AWS service. Converse is model-agnostic, so any Bedrock model with tool use
 * can be named in ZSITE_AI_MODEL without code changes.
 *
 * A hand-written loop rather than a framework: the model asks for tools, we
 * run them (each validates its own input), send the results back, and stop on
 * the model's final text or the iteration cap.
 *
 * Credentials come from the AWS SDK's default chain: env keys or AWS_PROFILE
 * locally, the task/Lambda role in production. Nothing is read here.
 */
import {
  BedrockRuntimeClient,
  type ContentBlock,
  ConverseCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
  type Message,
  type SystemContentBlock,
  type Tool,
  type ToolResultBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import { AgentError } from "../errors";
import type { SiteTool } from "../tools";
import { type Attachment, type Provider, type Usage, emptyUsage, isImageFormat } from "./types";

/** Anything with the client's `send` — a real BedrockRuntimeClient, or a fake in tests. */
export type ConverseSender = { send(command: ConverseCommand): Promise<ConverseCommandOutput> };

export type BedrockOptions = {
  client?: ConverseSender;
  region?: string;
  /** Output cap per request; must be within the model's limit (5,000 is safe across Nova models). */
  maxTokens?: number;
  /** Tool calling is most reliable near-greedy; AWS recommends it for Nova. */
  temperature?: number;
  /** Add a cache point after the (large, stable) system prompt. Only for models that support prompt caching. */
  promptCache?: boolean;
};

const MAX_MALFORMED_RETRIES = 2;

/** A tool's JSON Schema as the model should see it. `$schema` is dropped: it tells the model nothing and not every model accepts it. */
export function toolJsonSchema(t: SiteTool): Record<string, unknown> {
  const { $schema: _, ...schema } = t.jsonSchema ?? (z.toJSONSchema(t.inputSchema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>);
  return { type: "object", ...schema };
}

export function toBedrockTools(tools: SiteTool[]): Tool[] {
  return tools.map((t) => ({
    toolSpec: {
      name: t.name,
      description: t.description,
      inputSchema: { json: toolJsonSchema(t) as never },
    },
  }));
}

async function runTool(tools: SiteTool[], block: NonNullable<ContentBlock.ToolUseMember["toolUse"]>): Promise<ToolResultBlock> {
  const tool = tools.find((t) => t.name === block.name);
  try {
    if (!tool) throw new Error(`There is no tool called ${block.name}.`);
    return { toolUseId: block.toolUseId, content: [{ text: await tool.run(block.input) }], status: "success" };
  } catch (e) {
    return { toolUseId: block.toolUseId, content: [{ text: `Error: ${(e as Error).message}` }], status: "error" };
  }
}

function explain(e: unknown, model: string, region: string): never {
  try {
    explainOnly(e, model, region);
  } catch (out) {
    // These say the model cannot be used here at all — worth trying another.
    const name = (e as Error)?.name;
    if (out instanceof AgentError && (name === "AccessDeniedException" || name === "ResourceNotFoundException" || name === "ValidationException")) {
      out.unavailable = true;
    }
    throw out;
  }
}

function explainOnly(e: unknown, model: string, region: string): never {
  const err = e as Error & { name?: string };
  switch (err.name) {
    case "CredentialsProviderError":
      throw new AgentError("No AWS credentials found for Bedrock. Set AWS_PROFILE or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY (in production, the service's IAM role).");
    case "AccessDeniedException":
      if (/INVALID_PAYMENT_INSTRUMENT|payment instrument/i.test(err.message)) {
        throw new AgentError(
          `${model} is sold through AWS Marketplace, and AWS will not subscribe this account until it has a valid payment method (credits alone do not count). Add a card under Billing → Payment preferences in the AWS console, wait a few minutes and try again — or use an Amazon model (Nova), which needs no subscription.`,
        );
      }
      if (/marketplace/i.test(err.message)) {
        throw new AgentError(
          `${model} is sold through AWS Marketplace and this AWS account has not subscribed to it yet. Either run it once in the Bedrock playground (${region}) as an administrator — that subscribes the whole account — or give the caller aws-marketplace:ViewSubscriptions and aws-marketplace:Subscribe (the deployed services have them) so its first call subscribes. Allow a few minutes after either, then try again.`,
        );
      }
      if (/use case|use-case|form/i.test(err.message)) {
        throw new AgentError(`${model} needs Anthropic's one-time use-case form: open the model in the Bedrock console (${region}) and submit it, then try again.`);
      }
      throw new AgentError(`AWS refused access to ${model} in ${region}: ${err.message}`);
    case "ResourceNotFoundException":
    case "ValidationException": {
      // "Operation not allowed" is not about the request: AWS has not opened
      // Bedrock to this account yet (new accounts are held back, as CloudFront
      // is) or a Service Control Policy denies it. Pointing at the model id sends people
      // hunting in the wrong place.
      if (/operation not allowed/i.test(err.message)) {
        throw new AgentError(
          `AWS has not allowed this account to use ${model} in ${region} ("${err.message}"). The request itself is fine. Try the model once in the Bedrock playground in ${region} as an account administrator; if that fails the same way, open an AWS Support case (Account and billing) asking for Bedrock to be enabled on the account, and check no Service Control Policy denies it.`,
        );
      }
      const profileHint = /^(apac|us|eu|global)\./.test(model)
        ? ""
        : ` Some regions need an inference profile id (e.g. "apac.${model}").`;
      throw new AgentError(`Bedrock rejected the request for ${model} in ${region}: ${err.message}.${profileHint}`);
    }
    case "ThrottlingException":
    case "ServiceQuotaExceededException":
      throw new AgentError("Bedrock is throttling requests. Try again in a minute.");
    case "ModelNotReadyException":
    case "ServiceUnavailableException":
    case "InternalServerException":
      throw new AgentError(`Bedrock is temporarily unavailable (${err.name}). Try again shortly.`);
    default:
      throw e;
  }
}

/**
 * Converse names documents in the prompt and allows only letters, digits,
 * single spaces, hyphens, parentheses and square brackets, unique per request.
 */
export function documentName(raw: string, taken: Set<string>): string {
  const base = raw.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9 \-()[\]]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Attachment";
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
  taken.add(name);
  return name;
}

function attachmentBlocks(attachments: Attachment[]): ContentBlock[] {
  const taken = new Set<string>();
  return attachments.map((a): ContentBlock => {
    if (isImageFormat(a.format)) return { image: { format: a.format, source: { bytes: a.bytes } } };
    return { document: { name: documentName(a.name, taken), format: a.format, source: { bytes: a.bytes } } };
  });
}

/**
 * Nova writes its reasoning in <thinking> tags (sometimes unclosed, sometimes
 * with only the closing tag left). It is not for the version history.
 */
export function stripReasoning(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?(<\/thinking>|$)/gi, "")
    .replace(/^[\s\S]*?<\/thinking>/i, "")
    .trim();
}

/** Tokens already spent are still spent when a later request fails; the error carries them. */
function withUsage(fn: () => never, usage: Usage): never {
  try {
    fn();
  } catch (e) {
    if (e instanceof AgentError) e.usage = { ...usage };
    throw e;
  }
}

export function bedrockProvider(opts: BedrockOptions = {}): Provider {
  const region = opts.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "ap-south-1";
  const client = opts.client ?? new BedrockRuntimeClient({ region });

  return async ({ system, user, tools, model, maxIterations, attachments = [] }) => {
    const isClaude = /anthropic\.claude/.test(model);
    const systemBlocks: SystemContentBlock[] = [{ text: system }];
    if (opts.promptCache) systemBlocks.push({ cachePoint: { type: "default" } });
    const toolConfig = { tools: toBedrockTools(tools) };
    const messages: Message[] = [{ role: "user", content: [...attachmentBlocks(attachments), { text: user }] }];
    const usage = emptyUsage();
    let malformed = 0;
    let lastText = "";

    for (let i = 0; i < maxIterations; i++) {
      const input: ConverseCommandInput = {
        modelId: model,
        system: systemBlocks,
        messages,
        toolConfig,
        inferenceConfig: {
          maxTokens: opts.maxTokens ?? (isClaude ? 16000 : 5000),
          // Nova is most reliable at tool calling near-greedy. Current Claude models
          // reject sampling parameters outright, so none are sent for them.
          ...(isClaude ? {} : { temperature: opts.temperature ?? 0 }),
        },
      };
      let res: ConverseCommandOutput;
      try {
        res = await client.send(new ConverseCommand(input));
      } catch (e) {
        withUsage(() => explain(e, model, region), usage);
      }
      usage.requests++;
      usage.input_tokens += res.usage?.inputTokens ?? 0;
      usage.output_tokens += res.usage?.outputTokens ?? 0;
      usage.cache_read_input_tokens += res.usage?.cacheReadInputTokens ?? 0;

      const stop = res.stopReason ?? null;
      if (stop === "content_filtered" || stop === "guardrail_intervened") {
        return { finalText: "", model, usage, stopReason: stop, refused: true };
      }
      if (stop === "malformed_tool_use" || stop === "malformed_model_output") {
        // The model produced a call we cannot parse. Ask once or twice for a clean retry.
        if (++malformed > MAX_MALFORMED_RETRIES) throw Object.assign(new AgentError("The AI kept producing malformed tool calls. Try a simpler request."), { usage: { ...usage } });
        messages.push({ role: "user", content: [{ text: "Your last tool call could not be parsed. Call the tool again with valid JSON input matching its schema." }] });
        continue;
      }
      if (stop === "model_context_window_exceeded") throw Object.assign(new AgentError("This site is too large for the AI model's context. Try a smaller change."), { usage: { ...usage } });

      const message = res.output?.message;
      if (!message?.content) throw Object.assign(new AgentError("Bedrock returned no message."), { usage: { ...usage } });
      messages.push(message);
      const text = message.content
        .map((b) => ("text" in b && typeof b.text === "string" ? b.text : ""))
        .join(" ")
        .trim();
      const said = stripReasoning(text);
      if (said) lastText = said;

      const uses = message.content.flatMap((b) => ("toolUse" in b && b.toolUse ? [b.toolUse] : []));
      if (!uses.length) {
        return { finalText: lastText, model, usage, stopReason: stop, refused: false };
      }
      if (stop === "max_tokens") throw Object.assign(new AgentError("The AI's reply was cut off mid-edit. Try a smaller change."), { usage: { ...usage } });
      // All results for one assistant turn go back in a single user message.
      // In order, not in parallel: each call edits the tree the next one sees.
      const results: ToolResultBlock[] = [];
      for (const u of uses) results.push(await runTool(tools, u));
      messages.push({ role: "user", content: results.map((toolResult) => ({ toolResult })) });
    }
    return { finalText: lastText, model, usage, stopReason: "max_iterations", refused: false };
  };
}
