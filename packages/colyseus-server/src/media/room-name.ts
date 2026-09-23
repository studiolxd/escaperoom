import { DEFAULT_LIVEKIT_ROOM_PREFIX } from "./config.js";

/**
 * Derivación **GameRoom (Colyseus) ↔ room (LiveKit)** — specs/12 §1.
 *
 * Una room de LiveKit por `GameRoom`, nunca una compartida por evento. El
 * nombre se deriva del `roomId` de Colyseus (único por instancia) y no de su
 * `name` (compartido por clase), que es lo que garantiza el aislamiento entre
 * sesiones simultáneas. El prefijo evita colisiones si la misma API key la usan
 * otras aplicaciones.
 */

function sanitizePrefix(prefix: string | undefined): string {
  const trimmed = prefix?.trim();
  if (!trimmed) {
    return DEFAULT_LIVEKIT_ROOM_PREFIX;
  }
  const sanitized = trimmed
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || DEFAULT_LIVEKIT_ROOM_PREFIX;
}

/** `GameRoom.roomId` → nombre de la room de LiveKit (`escape-<roomId>`). */
export function deriveLiveKitRoomName(
  gameRoomId: string,
  prefix: string = DEFAULT_LIVEKIT_ROOM_PREFIX,
): string {
  const id = gameRoomId.trim();
  if (!id) {
    throw new Error("deriveLiveKitRoomName: gameRoomId vacío");
  }
  return `${sanitizePrefix(prefix)}-${id}`;
}

/**
 * Vuelta atrás (`escape-<roomId>` → `roomId`). Necesaria para que el
 * organizador-observador (specs/12 §1.1) sepa a qué GameRoom apunta una room de
 * LiveKit y pueda saltar de sesión en sesión. `null` si no la reconoce.
 */
export function gameRoomIdFromLiveKitRoomName(
  roomName: string,
  prefix: string = DEFAULT_LIVEKIT_ROOM_PREFIX,
): string | null {
  const expected = `${sanitizePrefix(prefix)}-`;
  if (!roomName.startsWith(expected)) {
    return null;
  }
  const id = roomName.slice(expected.length);
  return id.length > 0 ? id : null;
}
