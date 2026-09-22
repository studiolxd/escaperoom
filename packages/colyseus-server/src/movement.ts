/**
 * Validación de movimiento autoritativa (specs/04 §2, specs/11 §4.2).
 *
 * El servidor es la única fuente de verdad: acepta un paso si cae dentro de los
 * límites del grid y no supera la distancia máxima por tick. Cualquier salto de
 * más se rechaza como `MOVE_TOO_FAST` (anti-teletransporte). Este módulo es puro
 * y no depende de Colyseus, para poder testearlo sin levantar servidor.
 */

/** El salto pedido supera la distancia máxima permitida por tick. */
export const MOVE_TOO_FAST = "MOVE_TOO_FAST" as const;
/** La posición pedida queda fuera del grid de la sala. */
export const OUT_OF_BOUNDS = "OUT_OF_BOUNDS" as const;

export type MoveErrorCode = typeof MOVE_TOO_FAST | typeof OUT_OF_BOUNDS;

export interface Vector2 {
  x: number;
  y: number;
}

export interface MoveBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MoveLimits {
  /** Distancia máxima, en celdas, entre la posición actual y la pedida. */
  maxDistance: number;
  bounds: MoveBounds;
}

export type MoveValidationResult =
  { ok: true; position: Vector2 } | { ok: false; error: MoveErrorCode };

/** Distancia euclídea entre dos posiciones del grid. */
export function distance(a: Vector2, b: Vector2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** ¿La posición cae dentro de los límites del grid? */
export function isWithinBounds(position: Vector2, bounds: MoveBounds): boolean {
  return (
    position.x >= bounds.minX &&
    position.x <= bounds.maxX &&
    position.y >= bounds.minY &&
    position.y <= bounds.maxY
  );
}

/**
 * Valida un movimiento pedido por el cliente contra la posición autoritativa
 * actual. Devuelve la nueva posición si es legal, o un código de error si no lo
 * es (nunca lanza).
 */
export function validateMove(
  current: Vector2,
  requested: Vector2,
  limits: MoveLimits,
): MoveValidationResult {
  if (!Number.isFinite(requested.x) || !Number.isFinite(requested.y)) {
    return { ok: false, error: OUT_OF_BOUNDS };
  }

  if (!isWithinBounds(requested, limits.bounds)) {
    return { ok: false, error: OUT_OF_BOUNDS };
  }

  if (distance(current, requested) > limits.maxDistance) {
    return { ok: false, error: MOVE_TOO_FAST };
  }

  return { ok: true, position: { x: requested.x, y: requested.y } };
}
