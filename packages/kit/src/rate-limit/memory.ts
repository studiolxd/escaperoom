/**
 * Fixed-window limiter with NO infrastructure behind it — and, deliberately,
 * no imports either: neither Redis nor the logger, so a consumer that only
 * runs one instance can limit by IP without pulling ioredis into its bundle.
 *
 * Single-instance only. Multi-instance deployments use the Redis store from
 * `@escaperoom/kit/rate-limit`.
 */

export type RateLimitResult = {
  ok: boolean;
  /** Seconds until the window resets (only meaningful when !ok). */
  retryAfter: number;
  /**
   * Hits left in the current window, and seconds until it resets. Optional
   * and additive: a store may not know them (the Redis store fails open
   * without a count), and no existing caller reads them. They exist for
   * surfaces that publish a quota to their callers — an HTTP API answering
   * with `X-RateLimit-Remaining` cannot invent the number.
   */
  remaining?: number;
  resetSeconds?: number;
};

export interface RateLimitStore {
  /**
   * Records one hit for `key` and returns whether it is within `limit` for the
   * current `windowSeconds` window.
   */
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

/**
 * Duplicated from `./sliding` on purpose (not re-exported): this module has no
 * imports so a single-instance consumer never pulls in Redis/logger, and a
 * cross-import would defeat that.
 */
export type Clock = () => number;

/** In-memory fixed-window store. Single-instance only. */
export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(private readonly now: Clock = Date.now) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = this.now();
    this.sweep(now);

    const windowMs = windowSeconds * 1000;
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return {
        ok: true,
        retryAfter: 0,
        remaining: Math.max(0, limit - 1),
        resetSeconds: windowSeconds,
      };
    }

    bucket.count += 1;
    const resetSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    if (bucket.count > limit) {
      return { ok: false, retryAfter: resetSeconds, remaining: 0, resetSeconds };
    }
    return {
      ok: true,
      retryAfter: 0,
      remaining: Math.max(0, limit - bucket.count),
      resetSeconds,
    };
  }

  /** Drop expired buckets so the map doesn't grow unbounded. */
  private sweep(now: number) {
    if (now - this.lastSweep < 30_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

export function createRateLimiter(store: RateLimitStore = new MemoryRateLimitStore()) {
  return {
    check: (key: string, limit: number, windowSeconds: number) =>
      store.hit(key, limit, windowSeconds),
  };
}
