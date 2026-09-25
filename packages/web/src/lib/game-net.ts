import { Client, type Room } from "@colyseus/sdk";
import {
  EVENT_ROOM,
  GAME_ROOM,
  PLAYTEST_EXPIRED_CLOSE,
  PLAYTEST_ROOM,
  type GameRoomStateLike,
} from "@escaperoom/game-runtime/session";

/**
 * Capa de conexión del cliente de juego (fase 2): a qué room de Colyseus se
 * une la web y con qué opciones. Es la única pieza que conoce `@colyseus/sdk`;
 * el resto de la UI habla con `GameClient` (`@escaperoom/game-runtime/session`).
 *
 * - Partida (`game`): se crea una room nueva o se entra en una concreta por id
 *   (el link de invitación lleva `?room=<roomId>`). El cliente solo elige el
 *   **id** del paquete; el servidor lo resuelve (nunca viaja el paquete).
 * - Playtest (`playtest`, ticket 3.8): se empareja por `playtestId` con el token
 *   firmado del link de prueba.
 * - Evento (`event`, ticket 5.8): se empareja por `sessionId` con el `joinToken`
 *   del canje; el nombre visible lo fija el token, no el cliente.
 * - Observador (`spectate`, ticket 5.9): el organizador entra en la room `event`
 *   de una sesión **ya creada** con el `spectatorToken` del panel; nunca la crea
 *   ni ocupa plaza de jugador, y la room rechaza cualquier acción suya.
 */

export type GameJoinTarget =
  | {
      kind: "game";
      roomId?: string;
      packageId?: string;
      gameToken?: string;
      /**
       * Identidad de plaza estable por navegador (C-2, ajuste 2026-09-25): un
       * id aleatorio guardado en `localStorage` (`lib/game-reconnect.ts`), no
       * ligado a ninguna cuenta. La `GameRoom` desnuda no tiene `playerId`
       * (a diferencia de `EventRoom`, con el del `joinToken`), así que sin
       * esto recargar o cerrar y reabrir la pestaña entraba como jugador
       * NUEVO mientras la plaza antigua quedaba reservada vacía hasta el fin
       * de la partida. Nunca se expone a otros clientes de la room.
       */
      seatKey?: string;
    }
  | { kind: "playtest"; playtestId: string; token: string }
  | { kind: "event"; sessionId: string; joinToken: string }
  | { kind: "spectate"; sessionId: string; spectatorToken: string };

export type GameRoomHandle = Room<unknown, GameRoomStateLike>;

/** Nombre visible: sin `<>`, recortado a 32 como hace el servidor. */
export function sanitizePlayerName(name: string | null | undefined): string | undefined {
  const clean = (name ?? "").replace(/[<>]/g, "").trim().slice(0, 32);
  return clean.length > 0 ? clean : undefined;
}

/** Opciones de join de cada room (el servidor valida todo). */
export function joinOptions(
  target: GameJoinTarget,
  name?: string,
  characterId?: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = sanitizePlayerName(name)
    ? { name: sanitizePlayerName(name) }
    : {};
  // El personaje solo aplica a partidas reales (`game`): en evento/playtest/
  // observador el servidor asigna o no lo necesita.
  if (target.kind !== "playtest" && target.kind !== "event" && target.kind !== "spectate" && characterId) {
    base.characterId = characterId;
  }
  if (target.kind === "playtest") {
    return { ...base, playtestId: target.playtestId, token: target.token };
  }
  if (target.kind === "event") {
    return { sessionId: target.sessionId, joinToken: target.joinToken };
  }
  if (target.kind === "spectate") {
    return { sessionId: target.sessionId, spectatorToken: target.spectatorToken };
  }
  // `gameToken` (C-4) viaja siempre; `packageId` solo al crear (`roomId`
  // ausente): unirse a una room ya creada por id no lo necesita.
  return {
    ...base,
    ...(target.gameToken ? { gameToken: target.gameToken } : {}),
    ...(target.roomId || !target.packageId ? {} : { packageId: target.packageId }),
    ...(target.seatKey ? { seatKey: target.seatKey } : {}),
  };
}

/** Une a la room pedida; lanza si el servidor rechaza (link caducado, sala llena…). */
export async function joinGameRoom(
  client: Pick<Client, "create" | "join" | "joinById" | "joinOrCreate">,
  target: GameJoinTarget,
  name?: string,
  characterId?: string,
): Promise<GameRoomHandle> {
  const options = joinOptions(target, name, characterId);
  if (target.kind === "playtest") {
    return client.joinOrCreate<GameRoomStateLike>(PLAYTEST_ROOM, options);
  }
  if (target.kind === "event") {
    return client.joinOrCreate<GameRoomStateLike>(EVENT_ROOM, options);
  }
  if (target.kind === "spectate") {
    // `join` (no `joinOrCreate`): sin partida en curso no hay nada que observar.
    return client.join<GameRoomStateLike>(EVENT_ROOM, options);
  }
  if (target.roomId) {
    return client.joinById<GameRoomStateLike>(target.roomId, options);
  }
  return client.create<GameRoomStateLike>(GAME_ROOM, options);
}

/** Cierre por caducidad del playtest (el link dejó de servir). */
export function isExpiredClose(code: number): boolean {
  return code === PLAYTEST_EXPIRED_CLOSE;
}

/** Cierres "normales" del WebSocket (salida consentida del propio cliente). */
export function isConsentedClose(code: number): boolean {
  return code === 1000 || code === 4000;
}

/** Link de invitación a una partida concreta (`/play?room=<id>`), sin locale. */
export function invitePath(roomId: string): string {
  return `/play?room=${encodeURIComponent(roomId)}`;
}

/**
 * Link de juego de una sesión de evento tras el canje: `/play?session=<id>` con
 * el `joinToken` en el **fragmento** (`#joinToken=…`), que el navegador no manda
 * al servidor web ni queda en sus logs. Sin locale.
 */
export function eventPlayPath(sessionId: string, joinToken: string): string {
  return `/play?session=${encodeURIComponent(sessionId)}#joinToken=${encodeURIComponent(joinToken)}`;
}

/** `joinToken` del fragmento de la URL (`#joinToken=…`), si lo hay. */
export function readJoinTokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("joinToken");
  return token && token.length <= 2048 ? token : null;
}

/**
 * Link a `/play/room/:roomId` de una sala REAL (comprada o gratis, punto f/i
 * de "CTA Jugar", `docs/DEUDA.md`): el `gameToken` viaja en el **fragmento**
 * (`#gameToken=…`), igual que `eventPlayPath`, para que el navegador no lo
 * mande al servidor web ni quede en sus logs. `joinRoomId` (query, no
 * sensible) solo cuando hay una `GameRoom` "en curso" a la que unirse en vez
 * de crear otra (`RoomAccessResult.roomId`).
 */
export function roomGamePlayPath(roomId: string, gameToken: string, joinRoomId?: string): string {
  const query = joinRoomId ? `?join=${encodeURIComponent(joinRoomId)}` : "";
  return `/play/room/${encodeURIComponent(roomId)}${query}#gameToken=${encodeURIComponent(gameToken)}`;
}

/** `gameToken` del fragmento de la URL (`#gameToken=…`), si lo hay. */
export function readGameTokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("gameToken");
  return token && token.length <= 2048 ? token : null;
}

export { Client };
