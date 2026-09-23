import base from "@escaperoom/config/eslint/base";

// Artefactos de Playwright (informe HTML, trazas) y logs de los servidores: no son código.
export default [
  ...base,
  { ignores: ["playwright-report/**", "test-results/**", "blob-report/**", ".run/**"] },
];
