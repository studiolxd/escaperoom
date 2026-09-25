import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { logger } from "../logger";
import type { RateLimitResult } from "./memory";
import {
  MemorySlidingWindowStore,
  retryAfterSeconds,
  type Clock,
  type SlidingWindowStore,
} from "./sliding";

/**
 * Ventana DESLIZANTE sobre Redis (ticket 6.3): un sorted set por clave cuyos
 * scores son los instantes (ms) de los intentos aceptados. Segura con varias
 * réplicas de web: el recorte, el alta, el recuento y la lectura del más
 * antiguo van en un único MULTI (atómico en Redis).
 *
 * El intento se da de alta ANTES de saber si cabe y, si se pasa del límite, se
 * retira (`ZREM`). Así en el set solo quedan los aceptados, igual que en
 * `MemorySlidingWindowStore`. Entre el MULTI y el ZREM otra réplica puede ver
 * de más un rechazado ajeno: el error es hacia el lado seguro (rechazar), nunca
 * dejar pasar de más.
 *
 * Repliegue a memoria (E-22, auditoría): una caída de Redis ya NO deja pasar
 * todo — eso convertía cualquier corte de Redis en una ventana libre para la
 * fuerza bruta de `redeem` (el objetivo más sensible de este limitador). En
 * su lugar cae a un `MemorySlidingWindowStore` propio de este proceso: sigue
 * limitando (por proceso, no coordinado entre réplicas, igual que cuando no
 * hay `REDIS_URL` en absoluto), en vez de "permitir". Se avisa con
 * `logger.error` solo la PRIMERA vez que Redis falla (no en cada petición
 * mientras dure el corte, para no inundar los logs).
 */
export class RedisSlidingWindowStore implements SlidingWindowStore {
  private readonly fallback: MemorySlidingWindowStore;
  private warnedFallback = false;

  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
    private readonly now: Clock = Date.now,
  ) {
    this.fallback = new MemorySlidingWindowStore(now);
  }

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const redisKey = `${this.prefix}:rls:${key}`;
    const nowMs = this.now();
    const windowMs = windowSeconds * 1000;
    const member = `${nowMs}:${randomUUID()}`;
    try {
      const replies = await this.redis
        .multi()
        .zremrangebyscore(redisKey, 0, nowMs - windowMs)
        .zadd(redisKey, nowMs, member)
        .zcard(redisKey)
        .zrange(redisKey, "0", "0", "WITHSCORES")
        .pexpire(redisKey, windowMs)
        .exec();
      if (!replies) throw new Error("MULTI abortado");
      const failed = replies.find(([err]) => err);
      if (failed) throw failed[0];

      const count = Number(replies[2]![1]);
      const oldest = Number((replies[3]![1] as string[])[1] ?? nowMs);

      if (count > limit) {
        await this.redis.zrem(redisKey, member);
        const retryAfter = retryAfterSeconds(oldest, windowMs, nowMs);
        return { ok: false, retryAfter, remaining: 0, resetSeconds: retryAfter };
      }
      return {
        ok: true,
        retryAfter: 0,
        remaining: Math.max(0, limit - count),
        resetSeconds: retryAfterSeconds(oldest, windowMs, nowMs),
      };
    } catch (err) {
      this.warnFallbackOnce(err, key);
      return this.fallback.hit(key, limit, windowSeconds);
    }
  }
  async peek(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const redisKey = `${this.prefix}:rls:${key}`;
    const nowMs = this.now();
    const windowMs = windowSeconds * 1000;
    try {
      const replies = await this.redis
        .multi()
        .zremrangebyscore(redisKey, 0, nowMs - windowMs)
        .zcard(redisKey)
        .zrange(redisKey, "0", "0", "WITHSCORES")
        .exec();
      if (!replies) throw new Error("MULTI abortado");
      const failed = replies.find(([err]) => err);
      if (failed) throw failed[0];

      const count = Number(replies[1]![1]);
      if (count >= limit) {
        const oldest = Number((replies[2]![1] as string[])[1] ?? nowMs);
        const retryAfter = retryAfterSeconds(oldest, windowMs, nowMs);
        return { ok: false, retryAfter, remaining: 0, resetSeconds: retryAfter };
      }
      return { ok: true, retryAfter: 0, remaining: limit - count };
    } catch (err) {
      this.warnFallbackOnce(err, key);
      return this.fallback.peek(key, limit, windowSeconds);
    }
  }

  private warnFallbackOnce(err: unknown, key: string): void {
    if (this.warnedFallback) return;
    this.warnedFallback = true;
    logger.error(
      { err: err instanceof Error ? err : new Error(String(err)), key },
      "rate-limit: redis unavailable, falling back to an in-memory per-process limiter",
    );
  }
}
