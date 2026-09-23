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
    // El middleware de next-intl importa `next/server` sin extensión, que Node
    // no resuelve en ESM; procesado por Vite sí (lo usa `src/proxy.ts`, 6.3).
    test: { server: { deps: { inline: ["next-intl"] } } },
    resolve: {
      alias: [
        { find: /^@\//, replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/` },
      ],
    },
  }),
);
