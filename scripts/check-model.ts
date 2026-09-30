/**
 * Does a Bedrock model work in the site builder — not just in the playground?
 * Runs one real edit on a sample site with the builder's own tools and
 * instructions, with no fallback, and prints every round trip and the exact
 * error, so "it chats fine but the builder fails" has an answer.
 *
 *   npm run ai:check -- global.moonshotai.kimi-k3
 *   npm run ai:check -- global.openai.gpt-5.4 "Add an FAQ about delivery"
 *
 * Uses your AWS credentials (AWS_PROFILE or keys) and AWS_REGION (default ap-south-1).
 */
import { BedrockRuntimeClient, type ConverseCommand, type ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { bedrockProvider, editSite } from "@zsite/ai";
import { getTemplate } from "@zsite/core";

const model = process.argv[2];
const prompt = process.argv[3] ?? "Add an FAQ section about delivery and payment, and make the primary colour teal.";
if (!model) {
  console.error("usage: npm run ai:check -- <model id> [prompt]");
  process.exit(2);
}
const region = process.env.AWS_REGION || "ap-south-1";
const real = new BedrockRuntimeClient({ region });
let round = 0;

// The real client, narrated: what each round asked for and what came back.
const client = {
  async send(cmd: ConverseCommand): Promise<ConverseCommandOutput> {
    round++;
    const i = cmd.input;
    console.log(`\n── round ${round}: ${i.messages?.length} messages, ${i.toolConfig?.tools?.length ?? 0} tools, inferenceConfig ${JSON.stringify(i.inferenceConfig)}`);
    try {
      const res = await real.send(cmd);
      const blocks = res.output?.message?.content ?? [];
      console.log(`   stop: ${res.stopReason} · tokens in ${res.usage?.inputTokens} out ${res.usage?.outputTokens}`);
      for (const b of blocks) {
        if ("toolUse" in b && b.toolUse) console.log(`   tool call: ${b.toolUse.name} ${JSON.stringify(b.toolUse.input).slice(0, 300)}`);
        else if ("text" in b && b.text) console.log(`   text: ${b.text.slice(0, 300).replace(/\s+/g, " ")}`);
        else console.log(`   block: ${Object.keys(b).join(",")}`);
      }
      return res;
    } catch (e) {
      const err = e as Error & { $metadata?: { httpStatusCode?: number } };
      console.log(`   ✗ ${err.name} (${err.$metadata?.httpStatusCode ?? "?"}): ${err.message}`);
      throw e;
    }
  },
};

const tree = getTemplate("landing-launch").build({ businessName: "Asha Bakes" });
try {
  const r = await editSite({
    tree,
    prompt,
    model,
    fallbackModel: "",
    mcp: false,
    runner: bedrockProvider({ client: client as unknown as BedrockRuntimeClient, region }),
    context: { businessName: "Asha Bakes", siteKind: "landing", categories: [], productCount: 0, catalogueSource: null },
  });
  console.log(`\n✓ ${model} works in the builder: ${r.operations.length} change(s) in ${r.usage.requests} round(s).`);
  console.log(`  summary: ${r.summary}`);
  console.log(`  changes: ${r.operations.map((o) => o.op).join(", ")}`);
} catch (e) {
  console.log(`\n✗ ${model} failed in the builder: ${(e as Error).message}`);
  process.exitCode = 1;
}
