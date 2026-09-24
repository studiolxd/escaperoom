import type Redis from "ioredis";
import { logger } from "../logger";
import type { RateLimitResult, RateLimitStore } from "./memory";

// INCR y EXPIRE en un único script Lua: el servidor Redis ejecuta ambos
// comandos sin ceder el control a nadie más de por medio (a diferencia de un
// MULTI/EXEC seguido de un EXPIRE aparte), así que no hay ventana en la que
// la clave exista sin TTL (E-21): si el proceso muriera justo entre el INCR y
// el EXPIRE de una llamada no atómica, la clave quedaría viva para siempre.
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/**
 * Fixed-window store on Redis — multi-instance safe. INCR+EXPIRE se ejecutan
 * atómicamente en un script Lua; la TTL se fija una sola vez al abrir la
 * ventana. Fails open: rate limiting must never take the request down with
 * Redis.
 */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private redis: Redis,
    private prefix: string,
  ) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const redisKey = `${this.prefix}:rl:${key}`;
    try {
      const [count, ttl] = (await this.redis.eval(
        HIT_SCRIPT,
        1,
        redisKey,
        windowSeconds,
      )) as [number, number];

      const remaining = Math.max(0, limit - count);
      if (count > limit) {
        return { ok: false, retryAfter: ttl, remaining: 0, resetSeconds: ttl };
      }
      return { ok: true, retryAfter: 0, remaining, resetSeconds: ttl };
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err : new Error(String(err)), key },
        "rate-limit: redis unavailable, failing open",
      );
      return { ok: true, retryAfter: 0 };
    }
  }
}
