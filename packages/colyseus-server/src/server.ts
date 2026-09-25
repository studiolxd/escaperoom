import { matchMaker, Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import {
  DEFAULT_PORT,
  EVENT_ROOM_NAME,
  GAME_ROOM_NAME,
  LOBBY_ROOM_NAME,
  PLAYTEST_ROOM_NAME,
} from "./constants.js";
import { createEventProgressRouter } from "./events/http.js";
import { devTestGameTokenAllowed } from "./game/access-runtime.js";
import { createPlaytestRouter } from "./playtest/http.js";
import { EventRoom } from "./rooms/event-room.js";
import { GameRoom } from "./rooms/game-room.js";
import { LobbyTestRoom } from "./rooms/lobby-test-room.js";
import { PlaytestRoom } from "./rooms/playtest-room.js";

/**
 * Restringe las cabeceras CORS del matchmaker a `APP_URL`/`NEXT_PUBLIC_APP_URL`
 * (C-4): por defecto, `matchMaker.controller.getCorsHeaders` refleja cualquier
 * `Origin` (`Access-Control-Allow-Origin: *` sin ninguno), lo que deja el
 * listado/creación de rooms abierto a cualquier sitio. Sin ninguna de las dos
 * variables (solo en desarrollo: en producción `main.ts` las exige) no
 * restringe nada, para no romper `pnpm dev` con puertos que cambian.
 */
export function restrictMatchmakerCors(env: Record<string, string | undefined> = process.env): void {
  const allowedOrigin = env.APP_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim();
  if (!allowedOrigin) return;
  matchMaker.controller.getCorsHeaders = (headers: Headers) => ({
    "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    "Access-Control-Allow-Methods": "GET,HEAD,PUT,PATCH,POST,DELETE",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": headers.get("origin") === allowedOrigin ? allowedOrigin : "",
    "Access-Control-Max-Age": "2592000",
  });
}

/**
 * Crea el servidor Colyseus con las rooms `game` (partida del Rey Aldric,
 * ticket 2.8), `playtest` (borrador del editor, ticket 3.8) y `event` (sesión
 * de evento con `joinToken`, ticket 5.8) registradas, sin arrancarlo. La room
 * `lobby_test` (ticket 0.5) solo se registra fuera de producción (C-4): es una
 * room de prueba sin ningún gate, y en un despliegue real dejaría crear rooms
 * ilimitadas con tokens LiveKit de publicación gratis. La room de playtest se
 * empareja por `playtestId` (quien entra con el link se une a la partida de
 * ese playtest o la recrea desde el paquete congelado si se había vaciado), y
 * la ruta interna `POST /internal/playtests` la usa web para crear playtests;
 * `GET /internal/events/:eventId/progress` alimenta el panel del organizador
 * (ticket 5.9).
 */
export function createGameServer(): Server {
  restrictMatchmakerCors();
  const server = new Server({
    transport: new WebSocketTransport(),
    express: (app) => {
      app.use(createPlaytestRouter());
      app.use(createEventProgressRouter());
    },
  });
  if (devTestGameTokenAllowed()) {
    server.define(LOBBY_ROOM_NAME, LobbyTestRoom);
  }
  server.define(GAME_ROOM_NAME, GameRoom);
  definePlaytestRoom(server);
  defineEventRoom(server);
  return server;
}

/** Registra la room de playtest emparejada por `playtestId` (también la usan los tests). */
export function definePlaytestRoom(server: Pick<Server, "define">): void {
  server.define(PLAYTEST_ROOM_NAME, PlaytestRoom).filterBy(["playtestId"]);
}

/** Registra la room de evento: una por `gameSession`, emparejada por `sessionId`. */
export function defineEventRoom(server: Pick<Server, "define">): void {
  server.define(EVENT_ROOM_NAME, EventRoom).filterBy(["sessionId"]);
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
