import { existsSync } from "node:fs";
import { GAME_ROOM_NAME, LOBBY_ROOM_NAME, PLAYTEST_ROOM_NAME } from "./constants.js";
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
 * Punto de entrada de desarrollo: `pnpm --filter @escaperoom/colyseus-server dev`.
 * Arranca el servidor autoritativo con la room `lobby_test` en el puerto 2567
 * (o `COLYSEUS_PORT`/`PORT`).
 */
loadLocalEnv();
const port = resolvePort();
await startGameServer(port);
console.log(
  `[colyseus] rooms «${LOBBY_ROOM_NAME}», «${GAME_ROOM_NAME}» y «${PLAYTEST_ROOM_NAME}» escuchando en ws://localhost:${port}`,
);
