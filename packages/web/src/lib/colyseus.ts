/**
 * Coordenadas de la capa de red de la partida.
 *
 * La URL del servidor viene de `NEXT_PUBLIC_COLYSEUS_URL` (se inlinea en el
 * bundle del navegador) con `ws://localhost:2567` por defecto.
 */
export const COLYSEUS_URL = process.env.NEXT_PUBLIC_COLYSEUS_URL ?? "ws://localhost:2567";

/**
 * Room de una sesión de evento (ticket 5.8; `EVENT_ROOM_NAME` en
 * `@escaperoom/colyseus-server`, un test comprueba que coinciden): se entra
 * con `{ sessionId, joinToken }` tras `POST /api/access-keys/redeem`.
 */
export const EVENT_ROOM_NAME = "event" as const;
