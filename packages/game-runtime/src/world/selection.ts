import type { RuntimeObject } from "../loader";
import { isReachable } from "./pathfinding";

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
  /**
   * Vector unitario de "hacia dónde mira" el avatar (revisión en vivo: la
   * tecla Espacio solo debe interactuar con lo que tiene delante, no con
   * cualquier cosa dentro del radio). Sin este campo, sin filtro de
   * dirección (comportamiento por defecto, el que sigue usando el drag&drop
   * de items sobre el mundo). Un objeto en la propia celda del avatar
   * (distancia ~0) nunca se descarta por dirección, al no tener una hacia él.
   */
  facing?: { x: number; y: number };
}

/** Subconjunto mínimo de `RuntimeObject` que necesita la selección. */
export type SelectableObject = Pick<RuntimeObject, "id" | "position" | "interactable">;

/**
 * Devuelve el objeto interactuable más cercano a `cell` dentro de `radius`
 * (y, si se da `facing`, delante del avatar — semiplano, producto escalar
 * ≥ 0). A igual distancia desempata por `id` (orden estable). Nunca
 * devuelve un objeto fuera de radio, no interactuable, o a la espalda.
 */
export function nearestInteractable<T extends SelectableObject>(
  objects: readonly T[],
  cell: GridCell,
  options: NearestInteractableOptions = {},
): T | undefined {
  const radius = options.radius ?? INTERACT_RADIUS;
  const facing = options.facing;
  let best: T | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const object of objects) {
    if (!object.interactable) {
      continue;
    }
    const dx = object.position.x - cell.x;
    const dy = object.position.y - cell.y;
    const distance = Math.hypot(dx, dy);
    if (distance > radius + EPSILON) {
      continue;
    }
    if (facing && distance > EPSILON && dx * facing.x + dy * facing.y < -EPSILON) {
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
 * vecinos) más próxima a `from` que sea caminable Y alcanzable de verdad
 * desde `from` (BFS, `./pathfinding`, revisión en vivo) — antes solo se
 * comprobaba que el rectángulo delimitador entre las dos celdas estuviera
 * libre, una heurística insuficiente en salas no rectangulares (el
 * rectángulo puede incluir celdas fuera del contorno de la sala aunque
 * exista un camino real rodeando el obstáculo) que dejaba al avatar clavado
 * contra una estatua u otro obstáculo con el objetivo detrás. Si ninguna
 * adyacente es alcanzable, cae a la más cercana en línea recta sin más (y,
 * si tampoco hay ninguna caminable, a la propia celda del objeto). Es pura:
 * la transitabilidad entra como predicado.
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

  return candidates.find((c) => isReachable(from, c, isWalkable)) ?? candidates[0];
}

/**
 * Objetos interactuables que comparten celda con `objectId` (él incluido, en
 * el orden de `objects`), o `[]` si `objectId` no está en `objects`.
 *
 * Varios objetos pueden ocupar la misma celda como capas de un mismo
 * elemento (Rey Aldric, bodega (3,0): `mural-vendimia`, `mural-ranura` y
 * `compartimento-plata`, tres calcomanías sobre el mismo muro con el mismo
 * frame). Un clic en el canvas solo puede acertar a uno (el de encima: sus
 * zonas de clic son idénticas), así que el menú contextual usa esta lista
 * para dejar elegir a cuál se aplica la acción — sin ella, el mural del paso
 * 7 era inalcanzable al quitar el panel de objetos (smoke E2E, PR #187).
 */
export function colocatedInteractables<T extends SelectableObject>(
  objects: readonly T[],
  objectId: string,
): T[] {
  const target = objects.find((object) => object.id === objectId);
  if (!target) {
    return [];
  }
  const x = Math.round(target.position.x);
  const y = Math.round(target.position.y);
  return objects.filter(
    (object) =>
      (object.interactable || object.id === objectId) &&
      Math.round(object.position.x) === x &&
      Math.round(object.position.y) === y,
  );
}
