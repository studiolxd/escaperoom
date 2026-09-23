import { CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS } from "./constants";

/**
 * Rate limit de ventana deslizante para el chat (specs/11 §9: 2 msg/s).
 *
 * Lógica pura: no depende de Colyseus ni de relojes globales (el instante se
 * pasa como argumento), así que los tests corren sin infraestructura. El
 * servidor guarda un `ChatRateLimitState` por jugador y lo reemplaza por el que
 * devuelve `checkChatRateLimit`.
 */

export interface ChatRateLimitConfig {
  /** Nº máximo de mensajes permitidos dentro de la ventana. */
  max: number;
  /** Tamaño de la ventana, en milisegundos. */
  windowMs: number;
}

export const CHAT_RATE_LIMIT_DEFAULT: ChatRateLimitConfig = {
  max: CHAT_RATE_LIMIT,
  windowMs: CHAT_RATE_WINDOW_MS,
};

/** Instantes (ms) de los mensajes aceptados dentro de la ventana actual. */
export interface ChatRateLimitState {
  hits: readonly number[];
}

export type ChatRateLimitResult =
  | { ok: true; state: ChatRateLimitState }
  | { ok: false; retryAfterMs: number; state: ChatRateLimitState };

export const CHAT_RATE_LIMIT_EMPTY: ChatRateLimitState = { hits: [] };

/**
 * Registra un intento de mensaje en `now` y decide si se acepta. La ventana es
 * semiabierta `(now - windowMs, now]`: un mensaje justo en el borde caduca.
 */
export function checkChatRateLimit(
  state: ChatRateLimitState,
  now: number,
  config: ChatRateLimitConfig = CHAT_RATE_LIMIT_DEFAULT,
): ChatRateLimitResult {
  const windowStart = now - config.windowMs;
  const hits = state.hits.filter((ts) => ts > windowStart);

  if (hits.length >= config.max) {
    const oldest = hits[0]!;
    return {
      ok: false,
      retryAfterMs: Math.max(0, oldest + config.windowMs - now),
      state: { hits },
    };
  }

  return { ok: true, state: { hits: [...hits, now] } };
}
