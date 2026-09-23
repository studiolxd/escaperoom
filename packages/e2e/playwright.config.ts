import { defineConfig, devices } from "@playwright/test";
import { COLYSEUS_PORT, EDITOR_SYNC_PORT, LOCALE, WEB_URL } from "./support/env";

/**
 * Suite E2E con navegador (specs/22 §3). Playwright levanta los procesos
 * (`scripts/serve.ts`) contra la base del worktree (o la `DATABASE_URL` de CI)
 * ya migrada y sembrada (`global-setup.ts`): los tres para la suite completa,
 * sólo web + colyseus para `e2e:smoke` (no toca el editor).
 *
 *   pnpm --filter @escaperoom/e2e e2e          # suite completa (nightly)
 *   pnpm --filter @escaperoom/e2e e2e:smoke    # subset de PR (@smoke)
 *
 * `E2E_REUSE_SERVERS=1` reutiliza servidores ya arrancados en los mismos
 * puertos (iterar en local sin esperar al build de Next).
 */
const reuse = process.env.E2E_REUSE_SERVERS === "1";
const serve = (name: string) => `pnpm exec tsx scripts/serve.ts ${name}`;
// `e2e:smoke` (@smoke, subset de PR) sólo ejercita `game.reyaldric.spec.ts`,
// que no toca el editor: arrancar `editor-sync` ahí es un tercer proceso
// Node ocioso durante todo el test, uno de los que satura el runner de CI
// (2 vCPU/7GB) y hace que Chromium se cierre a mitad de test. La suite
// completa (nightly, `editor-publish.spec.ts`) sigue arrancando los tres.
const isSmoke = process.env.E2E_SMOKE === "1";

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
    // En CI, traza sólo si hace falta reintentar: grabarla en cada intento
    // (incl. los que pasan) es overhead de memoria continuo durante todo el
    // test, justo el recurso que le falta al runner. Con 2 reintentos, el
    // fallo se sigue pudiendo depurar (traza del 2º intento).
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    // Apagado en CI: es la captura más cara en memoria del runner y el trace +
    // screenshot en fallo ya bastan para depurar. En local sigue grabando.
    video: process.env.CI ? "off" : "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // `/dev/shm` en el runner de CI puede ser demasiado pequeño para el
          // uso por defecto de Chromium (memoria compartida entre pestañas);
          // al llenarse, el navegador se cierra a mitad de test con el mismo
          // síntoma que la presión de RAM general ("Target page ... has been
          // closed"). Sin coste en local, donde `/dev/shm` sobra.
          args: ["--disable-dev-shm-usage"],
        },
      },
    },
  ],
  webServer: [
    {
      command: serve("colyseus"),
      port: COLYSEUS_PORT,
      reuseExistingServer: reuse,
      timeout: 60_000,
      stdout: "ignore" as const,
    },
    // `editor-sync` no lo usa ningún test `@smoke`: sólo arranca en la suite
    // completa (nightly), donde sí corre `editor-publish.spec.ts`.
    ...(isSmoke
      ? []
      : [
          {
            command: serve("editor-sync"),
            port: EDITOR_SYNC_PORT,
            reuseExistingServer: reuse,
            timeout: 60_000,
            stdout: "ignore" as const,
          },
        ]),
    {
      command: serve("web"),
      url: `${WEB_URL}/${LOCALE}`,
      reuseExistingServer: reuse,
      // Incluye el `next build` con el entorno E2E cuando no hay uno reutilizable.
      timeout: 600_000,
      stdout: "ignore" as const,
    },
  ],
});
