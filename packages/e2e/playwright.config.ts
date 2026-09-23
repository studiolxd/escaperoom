import { defineConfig, devices } from "@playwright/test";
import { COLYSEUS_PORT, EDITOR_SYNC_PORT, LOCALE, WEB_URL } from "./support/env";

/**
 * Suite E2E con navegador (specs/22 §3). Playwright levanta los tres procesos
 * (`scripts/serve.ts`) contra la base del worktree (o la `DATABASE_URL` de CI)
 * ya migrada y sembrada (`global-setup.ts`).
 *
 *   pnpm --filter @escaperoom/e2e e2e          # suite completa (nightly)
 *   pnpm --filter @escaperoom/e2e e2e:smoke    # subset de PR (@smoke)
 *
 * `E2E_REUSE_SERVERS=1` reutiliza servidores ya arrancados en los mismos
 * puertos (iterar en local sin esperar al build de Next).
 */
const reuse = process.env.E2E_REUSE_SERVERS === "1";
const serve = (name: string) => `pnpm exec tsx scripts/serve.ts ${name}`;

export default defineConfig({
  testDir: "./tests",
  // Las suites comparten la base sembrada y los servidores: en serie, sin
  // pisarse (el coste está en el build de Next, no en los tests).
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // 2 reintentos en CI: el runner (ubuntu-latest, 2 vCPU/7GB) sostiene a la vez
  // Postgres + 3 procesos Node + Chromium con 2 páginas — bajo presión de
  // memoria, el navegador puede cerrarse a mitad de test ("Target page,
  // context or browser has been closed"), no es un fallo de la app.
  retries: process.env.CI ? 2 : 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: `${WEB_URL}/${LOCALE}`,
    locale: "es-ES",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Apagado en CI: es la captura más cara en memoria del runner y el trace +
    // screenshot en fallo ya bastan para depurar. En local sigue grabando.
    video: process.env.CI ? "off" : "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: serve("colyseus"),
      port: COLYSEUS_PORT,
      reuseExistingServer: reuse,
      timeout: 60_000,
      stdout: "ignore",
    },
    {
      command: serve("editor-sync"),
      port: EDITOR_SYNC_PORT,
      reuseExistingServer: reuse,
      timeout: 60_000,
      stdout: "ignore",
    },
    {
      command: serve("web"),
      url: `${WEB_URL}/${LOCALE}`,
      reuseExistingServer: reuse,
      // Incluye el `next build` con el entorno E2E cuando no hay uno reutilizable.
      timeout: 600_000,
      stdout: "ignore",
    },
  ],
});
