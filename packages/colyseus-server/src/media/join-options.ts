import type { MediaRole } from "./token.js";

/**
 * Opciones de join relacionadas con los medios. Colyseus entrega `options` sin
 * validar; aquí se normalizan sin lanzar para no romper el join si un cliente
 * manda basura (specs/11 §9: payload inválido no debe tumbar la partida).
 */
export interface MediaJoinOptions {
  role: MediaRole;
  /** `undefined` = usar el default de la config (`LIVEKIT_ALLOW_VIDEO`). */
  allowVideo?: boolean;
  name?: string;
}

export function parseMediaJoinOptions(options: unknown): MediaJoinOptions {
  const record = (options ?? {}) as Record<string, unknown>;
  const role: MediaRole = record.role === "observer" ? "observer" : "player";
  const allowVideo = typeof record.allowVideo === "boolean" ? record.allowVideo : undefined;
  const rawName = typeof record.name === "string" ? record.name.trim() : "";
  const name = rawName !== "" ? rawName.slice(0, 64) : undefined;
  return { role, allowVideo, name };
}
