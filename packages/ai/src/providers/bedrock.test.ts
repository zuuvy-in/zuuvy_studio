import type { ConverseCommand, ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { getTemplate } from "@zsite/core";
import { describe, expect, it } from "vitest";
import { editSite } from "../agent";
import { AgentError } from "../errors";
import { bedrockProvider } from "./bedrock";

const tree = () => getTemplate("store-classic").build({ businessName: "Demo Mobiles" });
const context = { businessName: "Demo Mobiles", siteKind: "store" as const, categories: [], productCount: 0, catalogueSource: null };

type Reply = Partial<ConverseCommandOutput>;

/** A scripted Bedrock: returns the replies in order and records every request. */
function fakeBedrock(replies: Reply[]) {
  const requests: ConverseCommand["input"][] = [];
  const client = {
    async send(cmd: ConverseCommand) {
      requests.push(structuredClone(cmd.input));
      const next = replies.shift();
      if (!next) throw new Error("no more scripted replies");
      return { usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }, metrics: { latencyMs: 1 }, $metadata: {}, ...next } as ConverseCommandOutput;
    },
  };
  return { client, requests };
}

const toolUse = (id: string, name: string, input: unknown): Reply => ({
  stopReason: "tool_use",
  output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: id, name, input: input as never } }] } },
});
const done = (text: string): Reply => ({
  stopReason: "end_turn",
  output: { message: { role: "assistant", content: [{ text }] } },
});

describe("bedrock provider (Converse loop)", () => {
  it("runs tool calls, feeds results back, and returns the edited tree", async () => {
    const { client, requests } = fakeBedrock([
      toolUse("t1", "set_theme", { colors: { primary: "#0f766e" } }),
      toolUse("t2", "add_section", { page: "/", type: "faq", props: { heading: "Delivery", items: [{ question: "How fast?", answer: "Two days." }] } }),
      done("Switched to a teal theme and added a delivery FAQ."),
    ]);
    const result = await editSite({
      tree: tree(),
      prompt: "Teal theme and a delivery FAQ",
      context,
      provider: "bedrock",
      runner: bedrockProvider({ client, region: "ap-south-1" }),
    });

    expect(result.provider).toBe("bedrock");
    expect(result.model).toBe("apac.amazon.nova-pro-v1:0");
    expect(result.summary).toBe("Switched to a teal theme and added a delivery FAQ.");
    expect(result.tree.theme.colors.primary).toBe("#0f766e");
    expect(result.tree.pages[0]!.sections.at(-1)!.type).toBe("faq");
    expect(result.usage).toMatchObject({ requests: 3, input_tokens: 300, output_tokens: 60 });

    // The request carried tool specs with JSON schemas, the system prompt, and near-greedy sampling.
    expect(requests[0]!.toolConfig!.tools!.map((t) => t.toolSpec!.name)).toContain("add_section");
    expect(JSON.stringify(requests[0]!.system)).toContain("site builder");
    expect(requests[0]!.inferenceConfig).toMatchObject({ temperature: 0 });
    // The second request carries the first tool's result, marked success.
    const results = requests[1]!.messages!.at(-1)!.content!;
    expect(results[0]).toMatchObject({ toolResult: { toolUseId: "t1", status: "success" } });
  });

  it("returns a bad tool call to the model as an error it can correct", async () => {
    const { client, requests } = fakeBedrock([
      toolUse("t1", "update_section", { section: "shop", props: { limit: 500 } }),
      toolUse("t2", "update_section", { section: "shop", props: { limit: 24 } }),
      done("Showing 24 products."),
    ]);
    const result = await editSite({ tree: tree(), prompt: "Show more products", context, runner: bedrockProvider({ client }) });
    const firstResult = requests[1]!.messages!.at(-1)!.content![0]!;
    expect(firstResult).toMatchObject({ toolResult: { toolUseId: "t1", status: "error" } });
    expect(JSON.stringify(firstResult)).toMatch(/limit/);
    expect(result.operations).toHaveLength(1);
  });

  it("treats a content filter as a refusal", async () => {
    const { client } = fakeBedrock([{ stopReason: "content_filtered", output: { message: { role: "assistant", content: [] } } }]);
    await expect(editSite({ tree: tree(), prompt: "x", context, runner: bedrockProvider({ client }) })).rejects.toThrow(/declined/);
  });

  it("says when nothing was changed (after asking once more)", async () => {
    const { client, requests } = fakeBedrock([done("That is already how the site looks."), done("That is already how the site looks.")]);
    await expect(editSite({ tree: tree(), prompt: "x", context, runner: bedrockProvider({ client }) })).rejects.toThrow(
      "The AI made no changes: That is already how the site looks.",
    );
    expect(requests).toHaveLength(2);
  });

  it("explains AWS errors in words", async () => {
    const client = {
      async send(): Promise<ConverseCommandOutput> {
        throw Object.assign(new Error("not authorized"), { name: "AccessDeniedException" });
      },
    };
    const err = await editSite({ tree: tree(), prompt: "x", context, runner: bedrockProvider({ client, region: "ap-south-1" }) }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect(err.message).toMatch(/refused access to apac\.amazon\.nova-pro-v1:0 in ap-south-1: not authorized/);
  });

  const failing = (name: string, message: string) => ({
    async send(): Promise<ConverseCommandOutput> {
      throw Object.assign(new Error(message), { name });
    },
  });

  it("says an account-level block is not the model id's fault", async () => {
    const client = failing("ValidationException", "Operation not allowed");
    const err = await editSite({ tree: tree(), prompt: "x", context, runner: bedrockProvider({ client, region: "ap-south-1" }) }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect(err.message).toMatch(/has not allowed this account/);
    expect(err.message).toMatch(/Support case/);
    expect(err.message).not.toMatch(/inference profile/);
  });

  it("suggests an inference profile only for a bare model id", async () => {
    const run = (model: string) =>
      editSite({ tree: tree(), prompt: "x", context, model, fallbackModel: "", runner: bedrockProvider({ client: failing("ValidationException", "Invocation of model ID amazon.nova-pro-v1:0 with on-demand throughput isn't supported."), region: "ap-south-1" }) }).catch((e) => e);
    expect((await run("amazon.nova-pro-v1:0")).message).toMatch(/inference profile id \(e\.g\. "apac\.amazon\.nova-pro-v1:0"\)/);
    expect((await run("apac.amazon.nova-pro-v1:0")).message).not.toMatch(/inference profile/);
  });
});

describe("Claude through Bedrock", () => {
  it("sends no sampling parameters to Claude, and keeps temperature 0 for Nova", async () => {
    const claude = fakeBedrock([toolUse("t1", "set_theme", { colors: { primary: "#0f766e" } }), done("Teal.")]);
    await editSite({ tree: tree(), prompt: "Teal", context, model: "global.anthropic.claude-sonnet-5", runner: bedrockProvider({ client: claude.client }) });
    expect(claude.requests[0]!.inferenceConfig).toEqual({ maxTokens: 16000 });
    const nova = fakeBedrock([toolUse("t1", "set_theme", { colors: { primary: "#0f766e" } }), done("Teal.")]);
    await editSite({ tree: tree(), prompt: "Teal", context, runner: bedrockProvider({ client: nova.client }) });
    expect(nova.requests[0]!.inferenceConfig).toMatchObject({ temperature: 0 });
  });
});

describe("Claude not yet enabled on the account", () => {
  it("says to open it once in the playground when AWS names Marketplace", async () => {
    const client = {
      async send(): Promise<ConverseCommandOutput> {
        throw Object.assign(new Error("Model access is denied due to IAM user or service role is not authorized to perform the required AWS Marketplace actions (aws-marketplace:ViewSubscriptions, aws-marketplace:Subscribe)"), { name: "AccessDeniedException" });
      },
    };
    const err = await editSite({ tree: tree(), prompt: "x", context, model: "global.anthropic.claude-sonnet-5", runner: bedrockProvider({ client, region: "ap-south-1" }) }).catch((e) => e);
    expect(err.message).toMatch(/not been enabled on this AWS account yet/);
  });
});
