import type { GridCell } from "./selection";

/** Predicado de transitabilidad de una celda del grid isométrico. */
export type Walkable = (x: number, y: number) => boolean;

/**
 * Diagonales primero: con todas las aristas al mismo coste (1), un BFS que
 * probara antes los 4 vecinos cardinales encuentra rutas "en escalera"
 * (der, der, abajo, der, abajo…) allí donde una línea recta en diagonal
 * habría bastado, porque gana el primer vecino en cola a igual profundidad.
 * Probar las diagonales antes hace que el avatar recorra el tramo diagonal
 * de una sola vez y solo cambie de dirección en el tramo recto final —
 * mucho más parecido a una línea recta (revisión en vivo: la animación de
 * caminar se cortaba y reiniciaba en cada cambio de dirección de la
 * escalera, ver `AvatarController.play`).
 */
const DIRECTIONS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

function key(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Techo de celdas visitadas antes de rendirse (undefined = sin camino). Las
 * salas reales son un grid finito pequeño (Rey Aldric: Salón del Trono, 280
 * celdas) donde `isWalkable` acota el área — un techo generoso no cambia el
 * resultado ahí, solo evita que un predicado no acotado (plano abierto sin
 * límites, p. ej. en un test) deje el BFS explorando indefinidamente.
 */
const DEFAULT_MAX_VISITED = 5_000;

/**
 * Ruta más corta (en número de pasos, diagonales incluidas) entre `from` y
 * `to` sobre el grid de colisión, con BFS de anchura uniforme (ticket
 * "pathfinding real", revisión en vivo). Sustituye a la comprobación de
 * "rectángulo delimitador libre" (`hasClearPath`, insuficiente en salas no
 * rectangulares: el avatar podía quedarse clavado contra una estatua u otro
 * obstáculo con el objetivo detrás). Devuelve `undefined` si `to` no es
 * caminable, no hay ningún camino, o se agota `maxVisited` sin encontrarlo.
 *
 * Un paso diagonal solo se admite si las dos celdas ortogonales
 * intermedias también son caminables — si no, la ruta "cortaría" la
 * esquina de una pared o un objeto sólido, cosa que el avatar no puede
 * hacer visualmente.
 */
export function findPath(
  from: GridCell,
  to: GridCell,
  isWalkable: Walkable,
  maxVisited: number = DEFAULT_MAX_VISITED,
): GridCell[] | undefined {
  const start: GridCell = { x: Math.round(from.x), y: Math.round(from.y) };
  const goal: GridCell = { x: Math.round(to.x), y: Math.round(to.y) };
  if (!isWalkable(goal.x, goal.y)) return undefined;
  if (start.x === goal.x && start.y === goal.y) return [start];

  const cameFrom = new Map<string, GridCell>();
  const visited = new Set<string>([key(start.x, start.y)]);
  const queue: GridCell[] = [start];

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]!;
    if (current.x === goal.x && current.y === goal.y) {
      const path: GridCell[] = [current];
      let cursor = key(current.x, current.y);
      let step = cameFrom.get(cursor);
      while (step) {
        path.push(step);
        cursor = key(step.x, step.y);
        step = cameFrom.get(cursor);
      }
      return simplifyPath(path.reverse(), isWalkable);
    }
    if (visited.size >= maxVisited) break;
    for (const { dx, dy } of DIRECTIONS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!isWalkable(nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        // No cortar esquinas: las dos celdas ortogonales también libres.
        if (!isWalkable(current.x + dx, current.y) || !isWalkable(current.x, current.y + dy)) continue;
      }
      const nextKey = key(nx, ny);
      if (visited.has(nextKey)) continue;
      if (visited.size >= maxVisited) break;
      visited.add(nextKey);
      cameFrom.set(nextKey, current);
      queue.push({ x: nx, y: ny });
    }
  }

  return undefined;
}

/**
 * `true` si se puede ir de `a` a `b` con el movimiento natural del avatar:
 * diagonal mientras los dos ejes tengan distancia por recorrer, y en línea
 * recta en el eje que quede una vez el otro llega a su valor final (así
 * avanza `RoomScene.readMove`, `Math.sign(dx)/Math.sign(dy)` hacia un único
 * punto). Comprueba que cada celda pisada sea caminable y que ningún paso
 * diagonal corte una esquina.
 */
function hasStraightWalk(a: GridCell, b: GridCell, isWalkable: Walkable): boolean {
  let x = a.x;
  let y = a.y;
  while (x !== b.x || y !== b.y) {
    const nx = x === b.x ? x : x + Math.sign(b.x - x);
    const ny = y === b.y ? y : y + Math.sign(b.y - y);
    if (!isWalkable(nx, ny)) return false;
    if (nx !== x && ny !== y && (!isWalkable(nx, y) || !isWalkable(x, ny))) return false;
    x = nx;
    y = ny;
  }
  return true;
}

/**
 * Reduce una ruta de pasos unitarios (BFS) al menor número de waypoints tal
 * que el tramo entre dos consecutivos sea un `hasStraightWalk` real —
 * evita que el avatar recorra un "zigzag" innecesario (p. ej. una "V" en
 * diagonal) cuando una línea recta habría bastado: con todas las aristas al
 * mismo coste, el BFS puede encontrar cualquiera de varias rutas igual de
 * cortas, no necesariamente la más recta (revisión en vivo: cada cambio de
 * dirección reinicia la animación de caminar, `AvatarController.play`).
 */
function simplifyPath(path: GridCell[], isWalkable: Walkable): GridCell[] {
  if (path.length <= 2) return path;
  const result: GridCell[] = [path[0]!];
  let anchor = 0;
  for (let i = 1; i < path.length - 1; i += 1) {
    if (!hasStraightWalk(path[anchor]!, path[i + 1]!, isWalkable)) {
      result.push(path[i]!);
      anchor = i;
    }
  }
  result.push(path[path.length - 1]!);
  return result;
}

/** `true` si existe algún camino entre `from` y `to` (sin construirlo). */
export function isReachable(
  from: GridCell,
  to: GridCell,
  isWalkable: Walkable,
  maxVisited?: number,
): boolean {
  return findPath(from, to, isWalkable, maxVisited) !== undefined;
}
