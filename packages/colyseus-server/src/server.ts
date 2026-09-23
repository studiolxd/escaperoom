import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { DEFAULT_PORT, GAME_ROOM_NAME, LOBBY_ROOM_NAME, PLAYTEST_ROOM_NAME } from "./constants.js";
import { createPlaytestRouter } from "./playtest/http.js";
import { GameRoom } from "./rooms/game-room.js";
import { LobbyTestRoom } from "./rooms/lobby-test-room.js";
import { PlaytestRoom } from "./rooms/playtest-room.js";

/**
 * Crea el servidor Colyseus con las rooms `lobby_test`, `game` (partida del
 * Rey Aldric, ticket 2.8) y `playtest` (borrador del editor, ticket 3.8)
 * registradas, sin arrancarlo. La room de playtest se empareja por
 * `playtestId` (quien entra con el link se une a la partida de ese playtest o
 * la recrea desde el paquete congelado si se había vaciado), y la ruta interna
 * `POST /internal/playtests` la usa web para crear playtests.
 * Colyseus ya responde con cabeceras CORS a las peticiones de matchmaking, así
 * que el cliente web puede conectar desde otro origen (p. ej. `localhost:3000`).
 */
export function createGameServer(): Server {
  const server = new Server({
    transport: new WebSocketTransport(),
    express: (app) => {
      app.use(createPlaytestRouter());
    },
  });
  server.define(LOBBY_ROOM_NAME, LobbyTestRoom);
  server.define(GAME_ROOM_NAME, GameRoom);
  definePlaytestRoom(server);
  return server;
}

/** Registra la room de playtest emparejada por `playtestId` (también la usan los tests). */
export function definePlaytestRoom(server: Pick<Server, "define">): void {
  server.define(PLAYTEST_ROOM_NAME, PlaytestRoom).filterBy(["playtestId"]);
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
