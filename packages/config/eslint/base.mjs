// Preset base de ESLint (flat config) del workspace. Cada app/paquete lo
// extiende. Adaptado de @slxd/config/eslint/base (ADR-017).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  ignores: [
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/coverage/**",
    "**/generated/**",
    "**/next-env.d.ts",
  ],
});
