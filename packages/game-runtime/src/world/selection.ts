import type { RuntimeObject } from "../loader";

/**
 * Selección fiable de objetos interactuables (specs/04 §4, ticket 1.14).
 *
 * La interacción apunta siempre al objeto interactuable **más cercano a la
 * celda del avatar** (no a coordenadas de pantalla) y con **desempate estable**:
 * a igual distancia gana el `id` lexicográficamente menor, de modo que la
 * elección no depende del orden de iteración ni "salta" a otro objeto entre
 * frames. Es lógica pura (sin Phaser ni React) para poder probarla sin
 * infraestructura; la escena Phaser la consume.
 */

/** Posición en celdas del grid isométrico. */
export interface GridCell {
  x: number;
  y: number;
}

/** Radio por defecto (en celdas) para considerar un objeto "al alcance". */
export const INTERACT_RADIUS = 1.75;

/** Tolerancia para comparar distancias en coma flotante (desempate estable). */
const EPSILON = 1e-9;

export interface NearestInteractableOptions {
  /** Radio máximo en celdas; por defecto {@link INTERACT_RADIUS}. */
  radius?: number;
}

/** Subconjunto mínimo de `RuntimeObject` que necesita la selección. */
export type SelectableObject = Pick<RuntimeObject, "id" | "position" | "interactable">;

/**
 * Devuelve el objeto interactuable más cercano a `cell` dentro de `radius`.
 * A igual distancia desempata por `id` (orden estable). Nunca devuelve un
 * objeto fuera de radio ni uno no interactuable.
 */
export function nearestInteractable<T extends SelectableObject>(
  objects: readonly T[],
  cell: GridCell,
  options: NearestInteractableOptions = {},
): T | undefined {
  const radius = options.radius ?? INTERACT_RADIUS;
  let best: T | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const object of objects) {
    if (!object.interactable) {
      continue;
    }
    const distance = Math.hypot(object.position.x - cell.x, object.position.y - cell.y);
    if (distance > radius + EPSILON) {
      continue;
    }

    if (best === undefined) {
      best = object;
      bestDistance = distance;
      continue;
    }

    const closer = distance < bestDistance - EPSILON;
    const tieBreak = Math.abs(distance - bestDistance) <= EPSILON && object.id < best.id;
    if (closer || tieBreak) {
      best = object;
      bestDistance = distance;
    }
  }

  return best;
}

/** Variante de {@link nearestInteractable} que solo devuelve el `id`. */
export function nearestInteractableId(
  objects: readonly SelectableObject[],
  cell: GridCell,
  options: NearestInteractableOptions = {},
): string | undefined {
  return nearestInteractable(objects, cell, options)?.id;
}

/**
 * Celda transitable desde la que acercarse a un objeto: la adyacente (8
 * vecinos) más próxima a `from` que sea caminable, con desempate estable. Si
 * ninguna adyacente lo es, cae a la propia celda del objeto si es caminable.
 * Es pura: la transitabilidad entra como predicado.
 */
export function approachCell(
  target: GridCell,
  from: GridCell,
  isWalkable: (x: number, y: number) => boolean,
): GridCell | undefined {
  const candidates: GridCell[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const x = Math.round(target.x) + dx;
      const y = Math.round(target.y) + dy;
      if (isWalkable(x, y)) {
        candidates.push({ x, y });
      }
    }
  }

  if (candidates.length === 0) {
    const x = Math.round(target.x);
    const y = Math.round(target.y);
    return isWalkable(x, y) ? { x, y } : undefined;
  }

  candidates.sort((a, b) => {
    const da = Math.hypot(a.x - from.x, a.y - from.y);
    const db = Math.hypot(b.x - from.x, b.y - from.y);
    if (Math.abs(da - db) > EPSILON) {
      return da - db;
    }
    if (a.x !== b.x) {
      return a.x - b.x;
    }
    return a.y - b.y;
  });

  return candidates[0];
}
