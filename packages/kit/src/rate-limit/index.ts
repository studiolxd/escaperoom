/**
 * Rate limiter for the API layer (tRPC procedures and REST route handlers).
 *
 * Dos limitadores por defecto: `rateLimiter` (ventana fija, el heredado de
 * SLXD) y `slidingRateLimiter` (ventana deslizante, ticket 6.3: el que usan las
 * rutas sensibles de web con 429 + `Retry-After`).
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
import { MemoryRateLimitStore, type RateLimitResult, type RateLimitStore } from "./memory";
import { RedisRateLimitStore } from "./redis-store";
import { MemorySlidingWindowStore, type SlidingWindowStore } from "./sliding";
import { RedisSlidingWindowStore } from "./sliding-redis";

export {
  createRateLimiter,
  MemoryRateLimitStore,
  type RateLimitResult,
  type RateLimitStore,
} from "./memory";
export { MemorySlidingWindowStore, retryAfterSeconds, type SlidingWindowStore } from "./sliding";
export { RedisSlidingWindowStore } from "./sliding-redis";

function warnPerProcess(): void {
  if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") {
    logger.warn(
      {},
      "rate-limit: REDIS_URL no está definida, la cuota es POR PROCESO. " +
        "En un despliegue con varias réplicas el límite efectivo se multiplica por el número de réplicas.",
    );
  }
}

function defaultStore(): RateLimitStore {
  const redis = getRedis();
  if (redis) return new RedisRateLimitStore(redis, redisPrefix());
  warnPerProcess();
  return new MemoryRateLimitStore();
}

function defaultSlidingStore(): SlidingWindowStore {
  const redis = getRedis();
  if (redis) return new RedisSlidingWindowStore(redis, redisPrefix());
  warnPerProcess();
  return new MemorySlidingWindowStore();
}

/**
 * Process-wide default limiter — Redis when REDIS_URL is set, else memory.
 * Lazy like `slidingRateLimiter` below (same reason: no store, no Redis
 * connection, until the first call — and `__resetInMemoryRateLimitersForTests`
 * can drop it to force a fresh one).
 */
let plainStore: RateLimitStore | undefined;
export const rateLimiter = {
  check: (key: string, limit: number, windowSeconds: number) =>
    (plainStore ??= defaultStore()).hit(key, limit, windowSeconds),
};

/**
 * Process-wide sliding-window limiter — Redis when REDIS_URL is set, else
 * memory. Lazy: the store is built on first use, so importing the module from
 * a route that never limits opens no Redis connection.
 */
let slidingStore: SlidingWindowStore | undefined;
export const slidingRateLimiter: SlidingWindowStore = {
  hit: (key, limit, windowSeconds) =>
    (slidingStore ??= defaultSlidingStore()).hit(key, limit, windowSeconds),
  peek: (key, limit, windowSeconds) =>
    (slidingStore ??= defaultSlidingStore()).peek(key, limit, windowSeconds),
};

/**
 * SOLO PARA TESTS: fuerza a `rateLimiter`/`slidingRateLimiter` a construir un
 * store nuevo en su próximo uso (en memoria, sin `REDIS_URL`; ver
 * `docs/reference/verify-pr.md` sobre cuándo SÍ hay `REDIS_URL` en los tests
 * de `web` — la causa real de "Tests de rate limit deterministas",
 * `docs/DEUDA.md`, era `REDIS_PREFIX` en `scripts/verify-pr.sh`, ya
 * arreglada). Defensa adicional, no la causa de aquel bug: si dos ficheros de
 * test llegaran a compartir el mismo singleton EN MEMORIA de este módulo
 * (p. ej. por cómo Vitest asigne workers), esto garantiza que cada fichero
 * empiece con cuota limpia. Llamar al principio (nivel de módulo, antes de
 * cualquier `it()`) de cualquier fichero de test que ejercite una ruta real
 * limitada.
 */
export function __resetInMemoryRateLimitersForTests(): void {
  plainStore = undefined;
  slidingStore = undefined;
}

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
