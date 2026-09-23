/**
 * Límite de llamadas a tools del MCP por token (ticket 4.7, specs/10 §5 "coste
 * de tokens"): ventana deslizante en memoria del proceso. Cada llamada
 * `tools/call` consume una unidad de la clave (la autorización OAuth, o el
 * usuario de la sesión web).
 */
export type RateLimitDecision =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSeconds: number; limit: number; windowSeconds: number };

export type RateLimiter = {
  readonly limit: number;
  readonly windowSeconds: number;
  /** Consume `cost` unidades de `key` si caben en la ventana. */
  consume(key: string, cost?: number): RateLimitDecision;
};

/** Por defecto: 60 llamadas a tools por minuto y token. */
export const DEFAULT_TOOL_RATE_LIMIT = { limit: 60, windowSeconds: 60 } as const;

export function createRateLimiter(
  options: { limit?: number; windowSeconds?: number; now?: () => number } = {},
): RateLimiter {
  const limit = options.limit ?? DEFAULT_TOOL_RATE_LIMIT.limit;
  const windowSeconds = options.windowSeconds ?? DEFAULT_TOOL_RATE_LIMIT.windowSeconds;
  const windowMs = windowSeconds * 1000;
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();

  return {
    limit,
    windowSeconds,
    consume(key, cost = 1) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => at > t - windowMs);
      if (recent.length + cost > limit) {
        hits.set(key, recent);
        const oldest = recent[Math.max(0, recent.length + cost - limit - 1)] ?? t;
        return {
          ok: false,
          retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - t) / 1000)),
          limit,
          windowSeconds,
        };
      }
      for (let i = 0; i < cost; i++) recent.push(t);
      hits.set(key, recent);
      // Poda ocasional de claves inactivas para no crecer sin límite.
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (!v.some((at) => at > t - windowMs)) hits.delete(k);
      }
      return { ok: true, remaining: limit - recent.length };
    },
  };
}
