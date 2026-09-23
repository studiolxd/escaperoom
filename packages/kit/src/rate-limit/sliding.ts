/**
 * Ventana DESLIZANTE (log de instantes) en memoria — ticket 6.3, specs/13 §11.
 *
 * A diferencia de la ventana fija de `./memory`, no hay un borde en el que el
 * contador se reinicia de golpe: un cliente no puede gastar la cuota al final
 * de una ventana y otra vez al principio de la siguiente (el doble de intentos
 * en un instante), que es justo el patrón de la fuerza bruta a `redeem`.
 *
 * Solo cuentan los intentos ACEPTADOS: un cliente que sigue golpeando tras el
 * 429 no alarga su bloqueo, y `Retry-After` dice la verdad (cuándo caduca el
 * aceptado más antiguo de la ventana).
 *
 * Sin imports, como `./memory`: vale para una sola instancia (dev, tests, CI).
 * En producción se usa `RedisSlidingWindowStore` (`./sliding-redis`).
 */

import type { RateLimitResult, RateLimitStore } from "./memory";

export type Clock = () => number;

/**
 * Store deslizante: además de `hit` (registra y decide), `peek` consulta si la
 * clave está agotada SIN registrar nada. Sirve para cuotas que solo cuentan
 * ciertos desenlaces (p. ej. canjes FALLIDOS): se consulta antes y se registra
 * con `hit` solo si la petición falló.
 */
export interface SlidingWindowStore extends RateLimitStore {
  peek(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

/** Segundos (enteros, ≥ 1) hasta que caduca el instante `oldestMs` de la ventana. */
export function retryAfterSeconds(oldestMs: number, windowMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((oldestMs + windowMs - nowMs) / 1000));
}

/** Log de instantes por clave en memoria. Una sola instancia. */
export class MemorySlidingWindowStore implements SlidingWindowStore {
  private readonly hits = new Map<string, { windowMs: number; list: number[] }>();
  private lastSweep = 0;

  constructor(private readonly now: Clock = Date.now) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const nowMs = this.now();
    const windowMs = windowSeconds * 1000;
    this.sweep(nowMs);

    // Ventana semiabierta (now - window, now]: un instante justo en el borde caduca.
    const alive = (this.hits.get(key)?.list ?? []).filter((ts) => ts > nowMs - windowMs);
    if (alive.length >= limit) {
      this.hits.set(key, { windowMs, list: alive });
      const retryAfter = retryAfterSeconds(alive[0] ?? nowMs, windowMs, nowMs);
      return { ok: false, retryAfter, remaining: 0, resetSeconds: retryAfter };
    }

    alive.push(nowMs);
    this.hits.set(key, { windowMs, list: alive });
    return {
      ok: true,
      retryAfter: 0,
      remaining: Math.max(0, limit - alive.length),
      resetSeconds: retryAfterSeconds(alive[0]!, windowMs, nowMs),
    };
  }

  async peek(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const nowMs = this.now();
    const windowMs = windowSeconds * 1000;
    const alive = (this.hits.get(key)?.list ?? []).filter((ts) => ts > nowMs - windowMs);
    if (alive.length >= limit) {
      const retryAfter = retryAfterSeconds(alive[0] ?? nowMs, windowMs, nowMs);
      return { ok: false, retryAfter, remaining: 0, resetSeconds: retryAfter };
    }
    return { ok: true, retryAfter: 0, remaining: limit - alive.length };
  }

  /** Descarta de vez en cuando las claves sin instantes vivos (el mapa no crece sin fin). */
  private sweep(nowMs: number): void {
    if (nowMs - this.lastSweep < 30_000) return;
    this.lastSweep = nowMs;
    for (const [key, { windowMs, list }] of this.hits) {
      const last = list[list.length - 1];
      if (last === undefined || last <= nowMs - windowMs) this.hits.delete(key);
    }
  }
}
