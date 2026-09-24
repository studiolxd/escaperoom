// Preset para `packages/web` (Next.js App Router): hooks, accesibilidad de
// JSX y las reglas propias de Next.js encima de la base compartida. Ver F-24
// en la auditoría (2026-09-24).
import nextPlugin from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactConfig from "./react.mjs";

export default [
  ...reactConfig,
  jsxA11y.flatConfigs.recommended,
  {
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
];
