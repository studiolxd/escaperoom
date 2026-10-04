import type { NavPoint, RoomNav } from "@escaperoom/nav3d";

/** Velocidad de paseo (m/s), specs/27 §5.3. */
export const WALK_SPEED = 3.5;
/** Distancia (m) a un punto de la ruta para darlo por alcanzado. */
export const ARRIVE_EPSILON = 0.05;
/** Velocidad de giro del avatar (°/s). */
export const TURN_SPEED_DEG = 720;

export interface Pose {
  x: number;
  y: number;
  h: number;
  yaw: number;
}

const normalizeDeg = (deg: number): number => ((deg % 360) + 360) % 360;

/** Giro (grados, [0, 360)) de quien avanza en la dirección `(dx, dy)`: 0 = +y, 90 = +x. */
export function yawOf(dx: number, dy: number): number {
  return normalizeDeg((Math.atan2(dx, dy) * 180) / Math.PI);
}

/** Gira `from` hacia `to` como mucho `maxDeg`, por el camino corto. Resultado en [0, 360). */
export function turnToward(from: number, to: number, maxDeg: number): number {
  const diff = ((((to - from) % 360) + 540) % 360) - 180;
  if (Math.abs(diff) <= maxDeg) return normalizeDeg(to);
  return normalizeDeg(from + Math.sign(diff) * maxDeg);
}

/** Avanza por la ruta `dt` segundos. Devuelve la pose nueva y la ruta que queda. */
export function followPath(
  pose: Pose,
  path: readonly NavPoint[],
  dt: number,
): { pose: Pose; rest: NavPoint[]; moving: boolean } {
  let { x, y, h, yaw } = pose;
  let remaining = WALK_SPEED * dt;
  let index = 0;
  let moving = false;
  let heading: number | undefined;

  while (index < path.length) {
    const target = path[index]!;
    const dx = target.x - x;
    const dy = target.y - y;
    const dh = target.h - h;
    const dist = Math.hypot(dx, dy, dh);
    if (dist <= ARRIVE_EPSILON) {
      x = target.x;
      y = target.y;
      h = target.h;
      index++;
      continue;
    }
    if (remaining <= 0) break;
    if (Math.hypot(dx, dy) > 1e-6) heading = yawOf(dx, dy);
    moving = true;
    if (dist <= remaining) {
      x = target.x;
      y = target.y;
      h = target.h;
      remaining -= dist;
      index++;
    } else {
      const k = remaining / dist;
      x += dx * k;
      y += dy * k;
      h += dh * k;
      break;
    }
  }

  if (heading !== undefined) yaw = turnToward(yaw, heading, TURN_SPEED_DEG * dt);
  return { pose: { x, y, h, yaw }, rest: path.slice(index), moving };
}

/** Paso de teclado: `dir` es un vector unitario en el plano lógico. Usa `nav.slide`. */
export function stepToward(
  pose: Pose,
  dir: { x: number; y: number },
  dt: number,
  nav: RoomNav,
): { pose: Pose; moving: boolean } {
  const len = Math.hypot(dir.x, dir.y);
  if (len < 1e-9 || dt <= 0) return { pose, moving: false };
  const ux = dir.x / len;
  const uy = dir.y / len;
  const reach = WALK_SPEED * dt;
  const end = nav.slide(pose, { x: pose.x + ux * reach, y: pose.y + uy * reach, h: pose.h });
  const moved = Math.hypot(end.x - pose.x, end.y - pose.y);
  const yaw = turnToward(pose.yaw, yawOf(ux, uy), TURN_SPEED_DEG * dt);
  return {
    pose: { x: end.x, y: end.y, h: end.h, yaw },
    moving: moved > reach * 0.05,
  };
}
