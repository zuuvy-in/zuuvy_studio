import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getTemplate } from "@zsite/core";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentError, editSite } from "../agent";
import { toBedrockTools } from "../providers/bedrock";
import type { Provider } from "../providers/types";
import { connectMcp, parseMcpServers, resultText, toolName } from "./client";
import { contrast, paletteFrom } from "./design-kit";

const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

describe("design kit palette", () => {
  it("keeps text, muted text and the primary colour readable from any start", () => {
    for (const brand of ["#22314f", "#e2503b", "#ffe600", "#00ff88", "#6a5cf5", "#ffffff", "#000000"]) {
      for (const mood of ["light", "dark", "warm", "cool", "vivid"] as const) {
        const p = paletteFrom(brand, mood);
        for (const v of [p.primary, p.background, p.surface, p.text, p.muted, p.accent]) expect(v).toMatch(/^#[0-9a-f]{6}$/);
        expect(contrast(p.text, p.background)).toBeGreaterThanOrEqual(7);
        expect(contrast(p.muted, p.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.primary, p.background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("leaves a brand colour that already reads alone", () => {
    expect(paletteFrom("#22314f").primary).toBe("#22314f");
  });
});

describe("MCP tools", () => {
  it("offers the design kit as prefixed tools, without photo search when no key is set", async () => {
    const mcp = await connectMcp();
    closers.push(() => mcp.close());
    const names = mcp.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["design__palette", "design__font_pairings", "design__style_recipe", "design__check_contrast"]));
    expect(names).not.toContain("design__search_photos");

    const palette = mcp.tools.find((t) => t.name === "design__palette")!;
    const out = JSON.parse(await palette.run({ brand: "#e2503b", mood: "dark" }));
    expect(out.background).toMatch(/^#/);
    const recipe = JSON.parse(await mcp.tools.find((t) => t.name === "design__style_recipe")!.run({ kind: "store", mood: "warm" }));
    expect(recipe.sections.join(" ")).toContain("productGrid");
  });

  it("returns a tool's own error to the model as a tool error", async () => {
    const mcp = await connectMcp();
    closers.push(() => mcp.close());
    await expect(mcp.tools.find((t) => t.name === "design__palette")!.run({ brand: "red" })).rejects.toThrow(/hex colour/);
  });

  it("searches Unsplash with the key and hands back https URLs with credit", async () => {
    const seen: string[] = [];
    const fakeFetch = (async (url: URL) => {
      seen.push(String(url));
      return new Response(
        JSON.stringify({
          results: [{ urls: { raw: "https://images.unsplash.com/photo-1?ixid=a" }, alt_description: "a bakery counter", description: null, width: 4000, height: 3000, user: { name: "Asha" } }],
        }),
      );
    }) as unknown as typeof fetch;
    const mcp = await connectMcp({ designKit: { unsplashKey: "k", fetch: fakeFetch } });
    closers.push(() => mcp.close());
    const out = JSON.parse(await mcp.tools.find((t) => t.name === "design__search_photos")!.run({ query: "bakery" }));
    expect(seen[0]).toMatch(/^https:\/\/api\.unsplash\.com\/search\/photos\?query=bakery/);
    expect(out.photos[0]).toMatchObject({ url: "https://images.unsplash.com/photo-1?ixid=a&w=1600&q=80&auto=format&fit=crop", credit: "Photo by Asha on Unsplash" });
  });

  it("connects a remote server over streamable HTTP and skips one that is down", async () => {
    const http = createServer(async (req, res) => {
      const server = new McpServer({ name: "remote", version: "1" });
      server.registerTool("shout", { description: "Upper-cases", inputSchema: { text: z.string() } }, async ({ text }) => ({
        content: [{ type: "text", text: text.toUpperCase() }],
      }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => void transport.close());
      await server.connect(transport);
      let body = "";
      for await (const chunk of req) body += chunk;
      await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
    });
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    closers.push(() => new Promise<void>((r) => http.close(() => r())));
    const port = (http.address() as AddressInfo).port;

    const mcp = await connectMcp({
      designKit: false,
      servers: [
        { name: "ui", url: `http://127.0.0.1:${port}/mcp` },
        { name: "gone", url: "http://127.0.0.1:1/mcp" },
      ],
      timeoutMs: 5000,
    });
    closers.push(() => mcp.close());
    expect(mcp.tools.map((t) => t.name)).toEqual(["ui__shout"]);
    expect(mcp.summary).toEqual(["ui: ui__shout"]);
    expect(await mcp.tools[0]!.run({ text: "hi" })).toBe("HI");
    // The server's JSON Schema reaches the model as it is, minus $schema.
    const spec = toBedrockTools(mcp.tools)[0]!.toolSpec!.inputSchema!.json as Record<string, unknown>;
    expect(spec.$schema).toBeUndefined();
    expect(spec).toMatchObject({ type: "object", properties: { text: { type: "string" } } });
  });

  it("parses the server list and drops bad entries", () => {
    expect(parseMcpServers('[{"name":"ui","url":"https://mcp.example.com/mcp","headers":{"Authorization":"Bearer x"}},{"name":"bad name","url":"x"}]')).toEqual([
      { name: "ui", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer x" } },
    ]);
    expect(parseMcpServers("not json")).toEqual([]);
    expect(parseMcpServers(undefined)).toEqual([]);
    expect(toolName("ui", "get.component/v2")).toBe("ui__get_component_v2");
    expect(resultText({ content: [{ type: "image" }], structuredContent: undefined })).toBe("[image omitted]");
  });
});

describe("model fallback", () => {
  const context = { businessName: "Asha Bakes", siteKind: "landing" as const, categories: [], productCount: 0, catalogueSource: null };

  it("moves to the fallback model when the configured one cannot be used", async () => {
    const tree = getTemplate("landing-launch").build({ businessName: "Asha Bakes" });
    const models: string[] = [];
    const runner: Provider = async ({ model, tools }) => {
      models.push(model);
      if (model === "global.anthropic.claude-sonnet-5") {
        throw Object.assign(new AgentError("not enabled"), { unavailable: true, usage: { input_tokens: 5, output_tokens: 0, cache_read_input_tokens: 0, requests: 1 } });
      }
      await tools.find((t) => t.name === "set_theme")!.run({ radius: "lg" });
      return { finalText: "Rounder corners.", model, usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, requests: 1 }, stopReason: "end_turn", refused: false };
    };
    const result = await editSite({ tree, prompt: "rounder", context, runner, model: "global.anthropic.claude-sonnet-5" });
    expect(models).toEqual(["global.anthropic.claude-sonnet-5", "apac.amazon.nova-pro-v1:0"]);
    expect(result.model).toBe("apac.amazon.nova-pro-v1:0");
    expect(result.fellBack).toMatch(/could not be used/);
    expect(result.usage.input_tokens).toBe(15);
  });

  it("does not fall back when turned off, or for other failures", async () => {
    const tree = getTemplate("landing-launch").build({ businessName: "Asha Bakes" });
    const refused: Provider = async () => {
      throw Object.assign(new AgentError("not enabled"), { unavailable: true });
    };
    await expect(editSite({ tree, prompt: "x", context, runner: refused, model: "m", fallbackModel: "" })).rejects.toThrow("not enabled");
    const busy: Provider = async () => {
      throw new AgentError("Bedrock is throttling requests.");
    };
    await expect(editSite({ tree, prompt: "x", context, runner: busy, model: "m" })).rejects.toThrow(/throttling/);
  });

  it("gives the model the design kit when asked", async () => {
    const tree = getTemplate("landing-launch").build({ businessName: "Asha Bakes" });
    let seen: string[] = [];
    let prompt = "";
    const runner: Provider = async ({ tools, user, model }) => {
      seen = tools.map((t) => t.name);
      prompt = user;
      await tools.find((t) => t.name === "set_theme")!.run({ radius: "lg" });
      return { finalText: "ok", model, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, requests: 1 }, stopReason: "end_turn", refused: false };
    };
    await editSite({ tree, prompt: "x", context, runner, mcp: {} });
    expect(seen).toContain("design__palette");
    expect(prompt).toContain("Design helpers");
  });
});
