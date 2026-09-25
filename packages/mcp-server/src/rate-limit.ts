import { slidingRateLimiter } from "@escaperoom/kit/rate-limit";

/**
 * Límite de llamadas a tools del MCP por token (ticket 4.7, specs/10 §5 "coste
 * de tokens"): ventana deslizante sobre `slidingRateLimiter`
 * (`@escaperoom/kit/rate-limit`, D-25), la misma que usan las rutas REST
 * sensibles de `packages/web` (`docs/reference/seguridad.md` §1) — Redis
 * cuando `REDIS_URL` está configurada (multi-instancia), memoria por proceso
 * si no (dev/tests). Antes era siempre en memoria por proceso: en un
 * despliegue con varias réplicas del MCP la cuota real se multiplicaba por el
 * número de réplicas.
 */
export type RateLimitDecision =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSeconds: number; limit: number; windowSeconds: number };

export type RateLimiter = {
  readonly limit: number;
  readonly windowSeconds: number;
  /** Consume `cost` unidades de `key` si caben en la ventana. */
  consume(key: string, cost?: number): Promise<RateLimitDecision>;
};

/** Por defecto: 60 llamadas a tools por minuto y token. */
export const DEFAULT_TOOL_RATE_LIMIT = { limit: 60, windowSeconds: 60 } as const;

export function createRateLimiter(
  options: { limit?: number; windowSeconds?: number } = {},
): RateLimiter {
  const limit = options.limit ?? DEFAULT_TOOL_RATE_LIMIT.limit;
  const windowSeconds = options.windowSeconds ?? DEFAULT_TOOL_RATE_LIMIT.windowSeconds;

  return {
    limit,
    windowSeconds,
    async consume(key, cost = 1) {
      // `slidingRateLimiter.hit` cuenta de una en una; un lote JSON-RPC con
      // varias `tools/call` gasta `cost` unidades con `cost - 1` llamadas
      // adicionales que solo registran (no vuelven a decidir): si la primera
      // ya agota la cuota, el resto ni se intenta.
      let result = await slidingRateLimiter.hit(key, limit, windowSeconds);
      for (let i = 1; i < cost && result.ok; i += 1) {
        result = await slidingRateLimiter.hit(key, limit, windowSeconds);
      }
      if (!result.ok) {
        return { ok: false, retryAfterSeconds: result.retryAfter, limit, windowSeconds };
      }
      return { ok: true, remaining: result.remaining ?? Math.max(0, limit - 1) };
    },
  };
}
