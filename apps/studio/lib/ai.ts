import "server-only";
import { aiConfigured } from "@zsite/ai";
import { config } from "@zsite/platform";

/** Whether AI editing can be tried, and what to set up when it cannot. */
export function aiStatus(): { ready: boolean; hint: string } {
  const ready = aiConfigured();
  const hint =
    config.aiProvider() === "anthropic"
      ? "AI editing uses Claude: set ANTHROPIC_API_KEY in .env and restart."
      : "AI editing uses Amazon Nova on Bedrock: set AWS_REGION and AWS credentials (AWS_PROFILE or access keys) in .env, then restart.";
  return { ready, hint };
}
