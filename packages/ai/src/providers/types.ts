import type { SiteTool } from "../tools";

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; requests: number };

export const DOCUMENT_FORMATS = ["pdf", "csv", "doc", "docx", "xls", "xlsx", "html", "txt", "md"] as const;
export const IMAGE_FORMATS = ["png", "jpeg", "gif", "webp"] as const;
export type AttachmentFormat = (typeof DOCUMENT_FORMATS)[number] | (typeof IMAGE_FORMATS)[number];

/**
 * A file the person attached to their request: a brief as a PDF, a price list
 * as a spreadsheet, a screenshot of a site they like. Sent to the model as
 * material to read, never stored and never placed on the site.
 */
export type Attachment = { name: string; format: AttachmentFormat; bytes: Uint8Array };

export const isImageFormat = (f: AttachmentFormat): f is (typeof IMAGE_FORMATS)[number] =>
  (IMAGE_FORMATS as readonly string[]).includes(f);

/** One agent turn, as every provider receives it. */
export type ProviderRequest = {
  system: string;
  user: string;
  tools: SiteTool[];
  model: string;
  maxIterations: number;
  attachments?: Attachment[];
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
