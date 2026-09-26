import { existsSync } from "node:fs";
import { requireInProduction } from "@escaperoom/env";
import { initNodeSentry } from "@escaperoom/kit/observability/sentry-node";
import { EVENT_ROOM_NAME, GAME_ROOM_NAME, PLAYTEST_ROOM_NAME } from "./constants.js";
import { configureGameAccessRuntime } from "./game/access-runtime.js";
import { configureEventRuntime } from "./events/runtime.js";
import { resolvePort, startGameServer } from "./server.js";

/**
 * Carga `packages/shared/.env` (lo escribe `pnpm dev:env`) y
 * `packages/colyseus-server/.env` si existen, sin pisar variables ya exportadas
 * (mismo patrón que el worker). De ahí salen las credenciales de LiveKit; sin
 * ellas la sala funciona sin medios (specs/12, ticket 2.2).
 */
function loadLocalEnv(): void {
  for (const file of ["../shared/.env", ".env"]) {
    const path = `${process.cwd()}/${file}`;
    if (existsSync(path)) {
      process.loadEnvFile(path);
    }
  }
}

/**
 * Runtime de eventos (ticket 5.12): con `DATABASE_URL`, la room `event` lee el
 * paquete publicado de cada evento y persiste los hitos en Postgres. Sin ella
 * (solo desarrollo) juega el fixture sin persistir; en producción, la room
 * `event` rechaza crearse.
 */
async function configureEvents(): Promise<string> {
  if (!process.env.DATABASE_URL) {
    return process.env.NODE_ENV === "production" ? "desactivados (sin DATABASE_URL)" : "fixture";
  }
  const [{ prisma }, { createPrismaEventRuntimeStore }] = await Promise.all([
    import("@escaperoom/shared/db"),
    import("@escaperoom/shared/event-runtime-prisma"),
  ]);
  configureEventRuntime(createPrismaEventRuntimeStore(prisma));
  return "Postgres";
}

/**
 * Runtime de compras en Colyseus (B-4): con `DATABASE_URL`, `GameRoom` juega la
 * versión exacta comprada y reclama la única partida de cada `purchase`. Sin
 * ella, un `gameToken` de compra siempre se rechaza (la partida de prueba sin
 * compra no depende de este runtime).
 */
async function configureGameAccess(): Promise<string> {
  if (!process.env.DATABASE_URL) {
    return "desactivadas (sin DATABASE_URL)";
  }
  const [{ prisma }, { createPrismaGameAccessStore }] = await Promise.all([
    import("@escaperoom/shared/db"),
    import("@escaperoom/shared/game-access-prisma"),
  ]);
  configureGameAccessRuntime(createPrismaGameAccessStore(prisma));
  return "Postgres";
}

/**
 * Punto de entrada de desarrollo: `pnpm --filter @escaperoom/colyseus-server dev`.
 * Arranca el servidor autoritativo (rooms `game`, `playtest`, `event`) en el
 * puerto 2567 (o `COLYSEUS_PORT`/`PORT`).
 */
loadLocalEnv();
// E-4: en producción, sin estas variables el proceso no debe arrancar.
requireInProduction(process.env, [
  "DATABASE_URL",
  "JOIN_TOKEN_SECRET",
  "GAME_ACCESS_TOKEN_SECRET",
  "PLAYTEST_SECRET",
]);
console.info(`[env] NODE_ENV=${process.env.NODE_ENV ?? "development"} validado`);
// Sentry (ticket 6.4): sin SENTRY_DSN queda deshabilitado, sin romper nada.
initNodeSentry({ dsn: process.env.SENTRY_DSN });
const events = await configureEvents();
const gameAccess = await configureGameAccess();
const port = resolvePort();
await startGameServer(port);
console.log(
  `[colyseus] rooms «${GAME_ROOM_NAME}», «${PLAYTEST_ROOM_NAME}» y «${EVENT_ROOM_NAME}» ` +
    `(eventos: ${events}, compras: ${gameAccess}) escuchando en ws://localhost:${port}`,
);
