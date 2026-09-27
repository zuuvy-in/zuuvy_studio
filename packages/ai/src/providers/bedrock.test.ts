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

  it("says when nothing was changed", async () => {
    const { client } = fakeBedrock([done("That is already how the site looks.")]);
    await expect(editSite({ tree: tree(), prompt: "x", context, runner: bedrockProvider({ client }) })).rejects.toThrow(
      "The AI made no changes: That is already how the site looks.",
    );
  });

  it("explains AWS errors in words", async () => {
    const client = {
      async send(): Promise<ConverseCommandOutput> {
        throw Object.assign(new Error("not authorized"), { name: "AccessDeniedException" });
      },
    };
    const err = await editSite({ tree: tree(), prompt: "x", context, runner: bedrockProvider({ client, region: "ap-south-1" }) }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect(err.message).toMatch(/refused access to apac\.amazon\.nova-pro-v1:0 in ap-south-1/);
  });
});
