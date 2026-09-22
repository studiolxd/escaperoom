import { LOBBY_ROOM_NAME } from "./constants.js";
import { resolvePort, startGameServer } from "./server.js";

/**
 * Punto de entrada de desarrollo: `pnpm --filter @escaperoom/colyseus-server dev`.
 * Arranca el servidor autoritativo con la room `lobby_test` en el puerto 2567
 * (o `COLYSEUS_PORT`/`PORT`).
 */
const port = resolvePort();
await startGameServer(port);
console.log(`[colyseus] room '${LOBBY_ROOM_NAME}' escuchando en ws://localhost:${port}`);
