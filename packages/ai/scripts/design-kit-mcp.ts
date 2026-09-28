/**
 * The design kit over stdio, for any MCP client:
 *   claude mcp add zuuvy-design -- npx tsx packages/ai/scripts/design-kit-mcp.ts
 * Photo search needs UNSPLASH_ACCESS_KEY or PEXELS_API_KEY in the environment.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDesignKitServer } from "../src/mcp/design-kit";

await createDesignKitServer({
  unsplashKey: process.env.UNSPLASH_ACCESS_KEY || undefined,
  pexelsKey: process.env.PEXELS_API_KEY || undefined,
}).connect(new StdioServerTransport());
