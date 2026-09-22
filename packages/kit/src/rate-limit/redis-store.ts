import type Redis from "ioredis";
import { logger } from "../logger";
import type { RateLimitResult, RateLimitStore } from "./memory";

/**
 * Fixed-window store on Redis — multi-instance safe. INCR+EXPIRE keeps the
 * count atomic across instances; the TTL is set once when the window opens.
 * Fails open: rate limiting must never take the request down with Redis.
 */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private redis: Redis,
    private prefix: string,
  ) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const redisKey = `${this.prefix}:rl:${key}`;
    try {
      const [countReply, ttlReply] = (await this.redis
        .multi()
        .incr(redisKey)
        .ttl(redisKey)
        .exec()) as unknown as [[null, number], [null, number]];

      const count = countReply[1];
      let ttl = ttlReply[1];

      // First hit of the window (or a key that lost its TTL): open the window.
      if (ttl < 0) {
        await this.redis.expire(redisKey, windowSeconds);
        ttl = windowSeconds;
      }

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
