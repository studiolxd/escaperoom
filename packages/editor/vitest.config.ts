import { defineConfig, mergeConfig } from "vitest/config";
import base from "@escaperoom/config/vitest";

// Como el preset, más tests `.tsx` (render del grafo de reglas).
export default mergeConfig(
  base,
  defineConfig({ test: { include: ["test/**/*.test.ts", "test/**/*.test.tsx"] } }),
);
