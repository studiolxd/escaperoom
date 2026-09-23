import { fileURLToPath } from "node:url";
import base from "@escaperoom/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

/**
 * El tsconfig de Next fija `jsx: "preserve"` (lo compila Next); los tests que
 * renderizan componentes `.tsx` necesitan que Vite transforme el JSX y resuelva
 * el alias `@/` del tsconfig.
 */
export default mergeConfig(
  base,
  defineConfig({
    oxc: { jsx: { runtime: "automatic" } },
    resolve: {
      alias: [
        { find: /^@\//, replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/` },
      ],
    },
  }),
);
