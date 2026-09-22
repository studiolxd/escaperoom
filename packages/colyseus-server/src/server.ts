import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { DEFAULT_PORT, LOBBY_ROOM_NAME } from "./constants.js";
import { LobbyTestRoom } from "./rooms/lobby-test-room.js";

/**
 * Crea el servidor Colyseus con la room `lobby_test` registrada, sin arrancarlo.
 * Colyseus ya responde con cabeceras CORS a las peticiones de matchmaking, así
 * que el cliente web puede conectar desde otro origen (p. ej. `localhost:3000`).
 */
export function createGameServer(): Server {
  const server = new Server({ transport: new WebSocketTransport() });
  server.define(LOBBY_ROOM_NAME, LobbyTestRoom);
  return server;
}

/** Resuelve el puerto a partir de `COLYSEUS_PORT`/`PORT`, con 2567 por defecto. */
export function resolvePort(): number {
  const raw = process.env.COLYSEUS_PORT ?? process.env.PORT;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

/** Arranca el servidor en el puerto indicado (o el resuelto por entorno). */
export async function startGameServer(port: number = resolvePort()): Promise<Server> {
  const server = createGameServer();
  await server.listen(port);
  return server;
}
