/**
 * Constantes del chat en partida (specs/11 §4.4, §9; specs/17 §3).
 *
 * Viven en `shared` para que servidor y cliente usen exactamente los mismos
 * límites: longitud máxima del payload, ventana móvil del historial y umbral
 * del rate limit. El chat viaja por el WebSocket de la room (specs/11 §3–4).
 */

/** Longitud máxima de un mensaje, en caracteres (specs/11 §4.4). */
export const CHAT_MAX_LENGTH = 500;

/** Nº máximo de mensajes aceptados por ventana (specs/11 §4.4 y §9). */
export const CHAT_RATE_LIMIT = 2;

/** Duración de la ventana del rate limit, en milisegundos. */
export const CHAT_RATE_WINDOW_MS = 1_000;

/** Tamaño de la ventana móvil de historial que se sincroniza (specs/11 §3). */
export const CHAT_HISTORY_LIMIT = 50;

/** Mensaje cliente → servidor con el texto del chat (specs/11 §4.4). */
export const CHAT_MESSAGE = "chat" as const;

/** Carácter con el que se censuran los términos prohibidos detectados. */
export const CHAT_CENSOR_MASK = "*";

/** Código de error de protocolo cuando se supera el rate limit (specs/11 §7). */
export const CHAT_RATE_LIMITED_ERROR = "RATE_LIMITED" as const;

/** Código de error cuando el payload del chat no pasa el schema (specs/11 §9). */
export const CHAT_INVALID_PAYLOAD_ERROR = "INVALID_STATE" as const;
