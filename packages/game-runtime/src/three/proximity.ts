import type { Pose } from "./movement";

export const PROXIMITY_RADIUS = 2; // m, en planta
export const PROXIMITY_CONE_DEG = 120; // total, centrado en el frente del avatar
export const PROXIMITY_MAX_HEIGHT = 1.5; // m de diferencia de altura
/** Por debajo de esta distancia (m) el objeto no se descarta por el cono. */
export const PROXIMITY_ALWAYS_M = 0.3;

const TIE_EPSILON = 1e-9;

/**
 * Objeto que se resalta por proximidad: el más cercano dentro del radio, del cono
 * frontal y de la diferencia de altura; a igual distancia (±1e-9), el `id` menor.
 */
export function highlightedObject(
  pose: Pose,
  candidates: readonly { id: string; x: number; y: number; h: number }[],
): string | undefined {
  const rad = (pose.yaw * Math.PI) / 180;
  const fx = Math.sin(rad);
  const fy = Math.cos(rad);
  const half = (PROXIMITY_CONE_DEG / 2) * (Math.PI / 180);
  let best: { id: string; dist: number } | undefined;

  for (const c of candidates) {
    const dx = c.x - pose.x;
    const dy = c.y - pose.y;
    const dist = Math.hypot(dx, dy);
    if (dist > PROXIMITY_RADIUS) continue;
    if (Math.abs(c.h - pose.h) > PROXIMITY_MAX_HEIGHT) continue;
    if (dist >= PROXIMITY_ALWAYS_M) {
      const cos = (dx * fx + dy * fy) / dist;
      if (Math.acos(Math.max(-1, Math.min(1, cos))) > half) continue;
    }
    if (
      !best ||
      dist < best.dist - TIE_EPSILON ||
      (Math.abs(dist - best.dist) <= TIE_EPSILON && c.id < best.id)
    ) {
      best = { id: c.id, dist };
    }
  }
  return best?.id;
}
