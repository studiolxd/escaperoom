/**
 * Coordenadas de la capa de red del lobby (ticket 0.5).
 *
 * La URL del servidor viene de `NEXT_PUBLIC_COLYSEUS_URL` (se inlinea en el
 * bundle del navegador) con `ws://localhost:2567` por defecto.
 */
export const LOBBY_ROOM_NAME = "lobby_test" as const;

export const COLYSEUS_URL = process.env.NEXT_PUBLIC_COLYSEUS_URL ?? "ws://localhost:2567";
