import base from "@escaperoom/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

// Además de `*.test.ts`, las suites E2E de specs/22 §3.3 (`mcp-parity.spec.ts`).
export default mergeConfig(
  base,
  defineConfig({ test: { include: ["test/**/*.test.ts", "test/**/*.spec.ts"] } }),
);
