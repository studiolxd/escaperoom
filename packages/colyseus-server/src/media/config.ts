/**
 * Configuración del módulo de medios (LiveKit) — specs/12 §2.
 *
 * Las credenciales viven **solo en el servidor** (`LIVEKIT_URL`,
 * `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`). Si falta cualquiera de las tres, el
 * módulo queda desactivado (`readMediaConfig` devuelve `null`) y la room sigue
 * funcionando sin medios: la degradación limpia que pide el ticket 2.2.
 */

/** Prefijo del nombre de room de LiveKit derivado del id de la GameRoom. */
export const DEFAULT_LIVEKIT_ROOM_PREFIX = "escape";

/**
 * TTL por defecto del token LiveKit: 6 h. specs/11 §8 lo ata a la duración
 * máxima de la sesión; hasta que exista ese valor real, 6 h cubren de sobra una
 * partida y se puede ajustar por `LIVEKIT_TOKEN_TTL_SECONDS`.
 */
export const DEFAULT_TOKEN_TTL_SECONDS = 6 * 60 * 60;

/** Entorno visible para el módulo (inyectable en tests). */
export type MediaEnv = Record<string, string | undefined>;

export interface MediaConfig {
  /** URL de signaling (`wss://…` o `ws://localhost:7880` en dev). */
  url: string;
  apiKey: string;
  apiSecret: string;
  /** Prefijo del nombre de room de LiveKit (`escape-<roomId>`). */
  roomPrefix: string;
  /** TTL del token en segundos. */
  tokenTtlSeconds: number;
  /**
   * ¿Se firma el permiso de vídeo cuando el join no lo especifica? Decisión de
   * cámara por defecto: en este lobby de desarrollo seguimos la fila B2C de
   * specs/12 §6 (vídeo permitido, cada jugador controla su cámara) y por eso el
   * default es `true`; un join puede forzarlo a `false` (contexto educativo).
   */
  allowVideoByDefault: boolean;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  return !(normalized === "false" || normalized === "0" || normalized === "no");
}

/**
 * Lee la configuración de LiveKit del entorno. Devuelve `null` (medios
 * desactivados) si falta cualquier credencial, nunca lanza.
 */
export function readMediaConfig(env: MediaEnv = process.env): MediaConfig | null {
  const url = env.LIVEKIT_URL?.trim();
  const apiKey = env.LIVEKIT_API_KEY?.trim();
  const apiSecret = env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) {
    return null;
  }
  return {
    url,
    apiKey,
    apiSecret,
    roomPrefix: env.LIVEKIT_ROOM_PREFIX?.trim() || DEFAULT_LIVEKIT_ROOM_PREFIX,
    tokenTtlSeconds: parsePositiveInt(env.LIVEKIT_TOKEN_TTL_SECONDS, DEFAULT_TOKEN_TTL_SECONDS),
    allowVideoByDefault: parseBoolean(env.LIVEKIT_ALLOW_VIDEO, true),
  };
}

/** `true` solo si hay las tres credenciales y se puede firmar un token. */
export function isMediaConfigured(env: MediaEnv = process.env): boolean {
  return readMediaConfig(env) !== null;
}
