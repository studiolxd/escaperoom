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
 */

export type GameJoinTarget =
  | { kind: "game"; roomId?: string; packageId?: string }
  | { kind: "playtest"; playtestId: string; token: string }
  | { kind: "event"; sessionId: string; joinToken: string };

export type GameRoomHandle = Room<unknown, GameRoomStateLike>;

/** Nombre visible: sin `<>`, recortado a 32 como hace el servidor. */
export function sanitizePlayerName(name: string | null | undefined): string | undefined {
  const clean = (name ?? "").replace(/[<>]/g, "").trim().slice(0, 32);
  return clean.length > 0 ? clean : undefined;
}

/** Opciones de join de cada room (el servidor valida todo). */
export function joinOptions(target: GameJoinTarget, name?: string): Record<string, unknown> {
  const base = sanitizePlayerName(name) ? { name: sanitizePlayerName(name) } : {};
  if (target.kind === "playtest") {
    return { ...base, playtestId: target.playtestId, token: target.token };
  }
  if (target.kind === "event") {
    return { sessionId: target.sessionId, joinToken: target.joinToken };
  }
  return target.roomId || !target.packageId ? base : { ...base, packageId: target.packageId };
}

/** Une a la room pedida; lanza si el servidor rechaza (link caducado, sala llena…). */
export async function joinGameRoom(
  client: Pick<Client, "create" | "joinById" | "joinOrCreate">,
  target: GameJoinTarget,
  name?: string,
): Promise<GameRoomHandle> {
  const options = joinOptions(target, name);
  if (target.kind === "playtest") {
    return client.joinOrCreate<GameRoomStateLike>(PLAYTEST_ROOM, options);
  }
  if (target.kind === "event") {
    return client.joinOrCreate<GameRoomStateLike>(EVENT_ROOM, options);
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

export { Client };
