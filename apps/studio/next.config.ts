import { join } from "node:path";
import type { NextConfig } from "next";

// One .env at the repository root serves every process.
try {
  process.loadEnvFile(join(import.meta.dirname, "../../.env"));
} catch {
  /* no .env: the real environment is used */
}

const config: NextConfig = {
  turbopack: { root: join(import.meta.dirname, "../..") },
  transpilePackages: ["@zsite/core", "@zsite/platform", "@zsite/runtime", "@zsite/connectors", "@zsite/ai"],
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  experimental: {
    // An AI edit can take a minute or two; the action waits for it.
    serverActions: { bodySizeLimit: "1mb" },
  },
  async headers() {
    return [
      {
        source: "/((?!preview/).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        // The preview is framed by the studio itself and nobody else.
        source: "/preview/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }],
      },
    ];
  },
};

export default config;
