import { isDevFallbackAllowed } from "@escaperoom/env";

/**
 * Configuración del playtest del editor (ticket 3.8, specs/09 §3).
 *
 * Un único secreto compartido con `packages/web` (`PLAYTEST_SECRET`) protege
 * dos cosas, con separación de dominio: la ruta interna con la que web
 * registra un playtest y la firma HMAC del link de prueba. En producción es
 * obligatorio (sin él el playtest queda desactivado); en desarrollo y tests hay
 * un secreto fijo para que `pnpm dev` funcione sin configurar nada.
 */

/** Secreto de desarrollo: solo fuera de `NODE_ENV=production`. */
export const DEV_PLAYTEST_SECRET = "dev-playtest-secret-no-usar-en-produccion";

/** Caducidad por defecto del playtest y de su link: 2 h (una partida + margen). */
export const DEFAULT_PLAYTEST_TTL_SECONDS = 2 * 60 * 60;

/** Tope de caducidad configurable: un link de prueba no vive más de un día. */
export const MAX_PLAYTEST_TTL_SECONDS = 24 * 60 * 60;

export type PlaytestEnv = Record<string, string | undefined>;

export interface PlaytestConfig {
  secret: string;
  ttlSeconds: number;
}

/** Lee la configuración; `null` (playtest desactivado) si falta el secreto en producción. */
export function readPlaytestConfig(env: PlaytestEnv = process.env): PlaytestConfig | null {
  const configured = env.PLAYTEST_SECRET?.trim();
  const secret = configured || (isDevFallbackAllowed(env) ? DEV_PLAYTEST_SECRET : undefined);
  if (!secret) return null;
  const rawTtl = Number.parseInt(env.PLAYTEST_TTL_SECONDS ?? "", 10);
  const ttlSeconds =
    Number.isInteger(rawTtl) && rawTtl > 0
      ? Math.min(rawTtl, MAX_PLAYTEST_TTL_SECONDS)
      : DEFAULT_PLAYTEST_TTL_SECONDS;
  return { secret, ttlSeconds };
}
