import type { Usage } from "./providers/types";

/** A failure meant for the person asking — shown in the studio as-is. */
export class AgentError extends Error {
  override name = "AgentError";
  /** What the attempt had spent before it failed, when known — it is still billed. */
  usage?: Usage;
  /** Whether the model refused or simply changed nothing; absent for failures of the service. */
  outcome?: "refused" | "no_change";
  /** Pictures already generated (and paid for) before the failure. */
  images?: number;
}
