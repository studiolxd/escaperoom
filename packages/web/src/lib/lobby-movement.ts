/**
 * Helpers de movimiento del lado cliente.
 *
 * El servidor es autoritativo y solo acepta pasos de como mucho
 * `MAX_STEP_PER_TICK`; el cliente avanza hacia su objetivo en incrementos de
 * ese tamaño. La lógica es pura para poder testearla sin red ni canvas.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Devuelve el punto a `maxStep` de distancia de `current` en dirección a
 * `target`. Si `target` está más cerca que `maxStep`, devuelve `target`.
 */
export function stepTowards(current: Vec2, target: Vec2, maxStep: number): Vec2 {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const dist = Math.hypot(dx, dy);

  if (dist <= maxStep) {
    return { x: target.x, y: target.y };
  }

  const ratio = maxStep / dist;
  return { x: current.x + dx * ratio, y: current.y + dy * ratio };
}

/** Colapsa un vector de dirección a longitud 1 (o `null` si es nulo). */
export function normalizeDirection(x: number, y: number): Vec2 | null {
  if (x === 0 && y === 0) {
    return null;
  }
  const length = Math.hypot(x, y);
  return { x: x / length, y: y / length };
}
