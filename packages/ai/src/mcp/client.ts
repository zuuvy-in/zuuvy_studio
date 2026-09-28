/**
 * MCP servers as editor tools. Every tool a connected server lists becomes a
 * SiteTool named `<server>__<tool>`, so the model calls it like any other and
 * each provider adapter sends its JSON schema unchanged.
 *
 * Two kinds of server:
 * - the design kit (./design-kit.ts), always present, connected in-process;
 * - remote servers the operator lists in ZSITE_MCP_SERVERS (streamable HTTP).
 *   Those URLs come from the deployment, never from a user or the model, so
 *   they are not the SSRF door references.ts guards. No stdio: spawning
 *   packages inside the service container on every edit is not something to
 *   do in production.
 *
 * A server that cannot be reached is skipped with a warning. An edit must
 * never fail because an optional helper is down.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { type SiteTool, ToolInputError } from "../tools";
import { type DesignKitOptions, createDesignKitServer } from "./design-kit";

export type McpServerConfig = {
  /** Short name; prefixes the server's tools. Letters, digits, hyphen, underscore. */
  name: string;
  url: string;
  headers?: Record<string, string>;
  /** Only these tools (by the server's own names); default all. */
  tools?: string[];
};

export type McpOptions = {
  /** false turns the built-in design kit off; otherwise its photo keys. */
  designKit?: DesignKitOptions | false;
  servers?: McpServerConfig[];
  /** Per call. */
  timeoutMs?: number;
};

export type McpConnection = {
  tools: SiteTool[];
  /** One line per connected server and its tools, for the prompt. */
  summary: string[];
  close(): Promise<void>;
};

const RESULT_LIMIT = 12_000;
const NAME = /^[A-Za-z0-9_-]+$/;

/** Parse ZSITE_MCP_SERVERS: a JSON array of {name, url, headers?, tools?}. Bad entries are dropped with a warning. */
export function parseMcpServers(raw: string | undefined): McpServerConfig[] {
  if (!raw?.trim()) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    console.warn("ZSITE_MCP_SERVERS is not valid JSON; no MCP servers connected.");
    return [];
  }
  const entry = z.object({
    name: z.string().regex(NAME).max(20),
    url: z.url({ protocol: /^https?$/ }),
    headers: z.record(z.string(), z.string()).optional(),
    tools: z.array(z.string()).optional(),
  });
  return (Array.isArray(list) ? list : []).flatMap((item) => {
    const parsed = entry.safeParse(item);
    if (parsed.success) return [parsed.data];
    console.warn(`ZSITE_MCP_SERVERS: skipped an entry (${parsed.error.issues[0]?.message ?? "invalid"}).`);
    return [];
  });
}

/** Tool names must fit every provider: [A-Za-z0-9_-], at most 64 characters. */
export function toolName(server: string, tool: string): string {
  return `${server}__${tool.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);
}

type CallResult = { content?: unknown; structuredContent?: unknown; isError?: boolean };

/** MCP content blocks → the text a model reads back. */
export function resultText(result: CallResult): string {
  const blocks = Array.isArray(result.content) ? (result.content as { type: string; text?: string; uri?: string; resource?: { uri?: string; text?: string } }[]) : [];
  const parts = blocks.map((b) => {
    if (b.type === "text") return b.text ?? "";
    if (b.type === "resource") return b.resource?.text ?? `[resource ${b.resource?.uri ?? ""}]`;
    if (b.type === "resource_link") return `[link ${b.uri ?? ""}]`;
    return `[${b.type} omitted]`;
  });
  let text = parts.join("\n").trim();
  if (!text && result.structuredContent !== undefined) text = JSON.stringify(result.structuredContent);
  if (text.length > RESULT_LIMIT) text = `${text.slice(0, RESULT_LIMIT)}\n[truncated]`;
  return text || "(empty result)";
}

async function wrap(client: Client, server: string, only: string[] | undefined, timeoutMs: number): Promise<SiteTool[]> {
  const tools: SiteTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: timeoutMs });
    for (const t of page.tools) {
      if (only && !only.includes(t.name)) continue;
      tools.push({
        name: toolName(server, t.name),
        description: (t.description ?? t.title ?? t.name).slice(0, 1000),
        inputSchema: z.record(z.string(), z.unknown()),
        jsonSchema: t.inputSchema as Record<string, unknown>,
        run: async (input) => {
          const result = (await client.callTool(
            { name: t.name, arguments: (input ?? {}) as Record<string, unknown> },
            undefined,
            { timeout: timeoutMs },
          )) as CallResult;
          // A tool's own error goes back to the model to correct, like any tool's.
          if (result.isError) throw new ToolInputError(resultText(result));
          return resultText(result);
        },
      });
    }
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

/**
 * Connect the design kit and every configured server; returns their tools.
 * Always `close()` the result when the edit is done.
 */
export async function connectMcp(opts: McpOptions = {}): Promise<McpConnection> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const clients: Client[] = [];
  const tools: SiteTool[] = [];
  const summary: string[] = [];

  const attach = async (name: string, transport: Transport, only?: string[]) => {
    const client = new Client({ name: "zuuvy-studio", version: "1.0.0" });
    try {
      await client.connect(transport, { timeout: timeoutMs });
      clients.push(client);
      const own = await wrap(client, name, only, timeoutMs);
      const taken = new Set(tools.map((t) => t.name));
      const fresh = own.filter((t) => !taken.has(t.name));
      tools.push(...fresh);
      if (fresh.length) summary.push(`${name}: ${fresh.map((t) => t.name).join(", ")}`);
    } catch (e) {
      console.warn(`MCP server ${name} unavailable: ${(e as Error).message}`);
      await client.close().catch(() => {});
    }
  };

  if (opts.designKit !== false) {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createDesignKitServer(opts.designKit ?? {}).connect(serverSide);
    await attach("design", clientSide);
  }
  await Promise.all(
    (opts.servers ?? []).map((s) =>
      attach(s.name, new StreamableHTTPClientTransport(new URL(s.url), { requestInit: { headers: s.headers ?? {} } }), s.tools),
    ),
  );

  return {
    tools,
    summary,
    close: async () => {
      await Promise.all(clients.map((c) => c.close().catch(() => {})));
    },
  };
}
