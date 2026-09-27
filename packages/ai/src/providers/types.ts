import type { SiteTool } from "../tools";

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; requests: number };

/** One agent turn, as every provider receives it. */
export type ProviderRequest = {
  system: string;
  user: string;
  tools: SiteTool[];
  model: string;
  maxIterations: number;
};

export type ProviderResult = {
  /** The model's closing text: the one-line summary for the version history. */
  finalText: string;
  model: string;
  usage: Usage;
  stopReason: string | null;
  /** A safety filter, guardrail or refusal stopped the turn. */
  refused: boolean;
};

export type Provider = (req: ProviderRequest) => Promise<ProviderResult>;

export const emptyUsage = (): Usage => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, requests: 0 });
