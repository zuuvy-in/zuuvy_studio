import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    // The platform tests share one throwaway database per file; running files
    // in parallel would have them race each other's migrations.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
