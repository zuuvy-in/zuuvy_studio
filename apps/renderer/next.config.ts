import { join } from "node:path";
import type { NextConfig } from "next";

try {
  process.loadEnvFile(join(import.meta.dirname, "../../.env"));
} catch {
  /* no .env: the real environment is used */
}

const config: NextConfig = {
  turbopack: { root: join(import.meta.dirname, "../..") },
  // A self-contained server for the container image (infra/docker/next.Dockerfile).
  output: "standalone",
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  transpilePackages: ["@zsite/core", "@zsite/platform", "@zsite/runtime", "@zsite/connectors", "@zsite/ai"],
  // The AWS SDK resolves credential providers with dynamic imports; bundling can drop them.
  serverExternalPackages: ["pg", "@aws-sdk/client-bedrock-runtime"],
  poweredByHeader: false,
  // Sites are served on <name>.localhost in development.
  allowedDevOrigins: ["*.localhost"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default config;
