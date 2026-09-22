/**
 * Rate limiter for the API layer (tRPC procedures and REST route handlers).
 *
 * The default store is picked by environment: Redis (fixed window, atomic,
 * multi-instance safe) when REDIS_URL is set, otherwise an in-memory counter
 * that is correct for a single instance only.
 *
 * SIN `REDIS_URL` EL LÍMITE ES POR PROCESO, y eso es una decisión, no un
 * descuido: en producción REDIS_URL está siempre puesta, así que el repliegue
 * en memoria existe para dev, tests y CI. Un despliegue multiinstancia que se
 * olvide de la variable multiplicaría su cuota por el número de réplicas, y por
 * eso se AVISA una vez al arrancar cuando no está en desarrollo.
 */

import { logger } from "../logger";
import { getRedis, redisPrefix } from "../redis";
import {
  createRateLimiter,
  MemoryRateLimitStore,
  type RateLimitResult,
  type RateLimitStore,
} from "./memory";
import { RedisRateLimitStore } from "./redis-store";

export {
  createRateLimiter,
  MemoryRateLimitStore,
  type RateLimitResult,
  type RateLimitStore,
} from "./memory";

function defaultStore(): RateLimitStore {
  const redis = getRedis();
  if (redis) return new RedisRateLimitStore(redis, redisPrefix());
  if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") {
    logger.warn(
      {},
      "rate-limit: REDIS_URL no está definida, la cuota es POR PROCESO. " +
        "En un despliegue con varias réplicas el límite efectivo se multiplica por el número de réplicas.",
    );
  }
  return new MemoryRateLimitStore();
}

/** Process-wide default limiter — Redis when REDIS_URL is set, else memory. */
export const rateLimiter = createRateLimiter(defaultStore());

/**
 * Rate-limit guard for REST route handlers (uploads, signed-URL reads), which
 * bypass the tRPC middleware where limiting normally lives.
 *
 * `enabled` replaces the app-owned policy switch. The kit has no opinion on
 * that policy, so the caller passes the resolved boolean; defaults to enabled
 * so a caller that skips the option keeps limiting on.
 */
export async function checkRouteRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  opts: { enabled?: boolean } = {},
): Promise<RateLimitResult> {
  if (opts.enabled === false) return { ok: true, retryAfter: 0 };
  return rateLimiter.check(key, limit, windowSeconds);
}
