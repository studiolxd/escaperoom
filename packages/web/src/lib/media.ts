/**
 * Contrato de medios del cliente (ticket 2.2) — espejo de
 * `packages/colyseus-server/src/media`. No se importa del servidor para no
 * arrastrar `livekit-server-sdk` al bundle del navegador.
 */

/** Mensaje servidor → cliente con token/capacidades (specs/11 §8). */
export const MEDIA_TOKEN_MESSAGE = "media_token";

/** Mensaje cliente → servidor para (re)pedir el token en el join. */
export const MEDIA_TOKEN_REQUEST_MESSAGE = "request_media_token";

export type MediaRole = "player" | "observer";

export interface MediaTokenPayload {
  configured: boolean;
  token: string | null;
  url: string | null;
  room: string | null;
  identity: string;
  role: MediaRole;
  allowVideo: boolean;
  canPublish: boolean;
  canPublishVideo: boolean;
}

/**
 * Normaliza un payload de `media_token` sin lanzar. Devuelve `null` si no tiene
 * la forma mínima; en ese caso el overlay no conecta y queda en "sin medios".
 */
export function parseMediaTokenPayload(value: unknown): MediaTokenPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.identity !== "string" || record.identity === "") {
    return null;
  }
  return {
    configured: record.configured === true,
    token: typeof record.token === "string" ? record.token : null,
    url: typeof record.url === "string" ? record.url : null,
    room: typeof record.room === "string" ? record.room : null,
    identity: record.identity,
    role: record.role === "observer" ? "observer" : "player",
    allowVideo: record.allowVideo === true,
    canPublish: record.canPublish === true,
    canPublishVideo: record.canPublishVideo === true,
  };
}

/**
 * ¿Puede el cliente conectar al SFU? Hace falta todo: claves configuradas,
 * token firmado y URL. Si falta algo, el overlay muestra "sin medios" y la
 * partida continúa por Colyseus (specs/12: LiveKit no bloquea el gameplay).
 */
export function canConnectMedia(payload: MediaTokenPayload | null): boolean {
  return Boolean(payload?.configured && payload.token && payload.url);
}
