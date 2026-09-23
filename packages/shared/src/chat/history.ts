import { CHAT_HISTORY_LIMIT } from "./constants";

/**
 * Ventana móvil del historial de chat (specs/11 §3: últimos 50 mensajes).
 *
 * Pura y sin estado: recibe el historial actual y devuelve uno nuevo con el
 * mensaje añadido y, si supera el límite, sin los más antiguos. El servidor
 * sincroniza el resultado en `state.chat`; quien se une a la room recibe así la
 * ventana completa.
 */

/** Añade un mensaje conservando solo los `limit` más recientes. */
export function appendChatMessage<T>(
  history: readonly T[],
  message: T,
  limit = CHAT_HISTORY_LIMIT,
): T[] {
  const next = [...history, message];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Recorta un historial existente a sus `limit` mensajes más recientes. */
export function windowChatHistory<T>(history: readonly T[], limit = CHAT_HISTORY_LIMIT): T[] {
  return history.length > limit ? history.slice(history.length - limit) : [...history];
}
