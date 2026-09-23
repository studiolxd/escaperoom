import type { PuzzleState, SlidingPuzzleDefinition } from "../schemas";

/**
 * Plantilla `sliding_puzzle` (specs/06 §2.5). Toda la lógica —mezcla, paridad y
 * detección de victoria— vive aquí, en `shared`: el servidor genera la
 * disposición inicial y valida cada movimiento contra la definición, y el
 * cliente solo recibe una proyección pública (`toSlidingPuzzlePublicView`) con
 * el tablero, nunca la semilla ni la solución.
 *
 * La lógica es pura: `createSlidingState` y `move` no mutan `state`, devuelven
 * objetos nuevos, así que el host (Colyseus/React) decide cuándo y cómo
 * persistirlos, y los tests corren sin infraestructura (specs/22 §2.3).
 *
 * **Mezcla resoluble.** Nunca se genera una permutación impar (imposible de
 * resolver con movimientos válidos). Se barajan las fichas y, si el invariante
 * de paridad no se cumple, se corrige con una transposición; el resultado es
 * alcanzable desde la posición resuelta. Con `fixed_seed`, la semilla alimenta
 * un PRNG determinista (`createSlidingRng`, mulberry32) para que todos los
 * grupos reciban el mismo desorden (justicia competitiva).
 *
 * **Representación.** `tiles` es row-major: índice de celda → ficha
 * (`1..N-1`); `0` es el hueco. La posición resuelta es `[1, 2, …, N-1, 0]`.
 * `blankPosition` fija en qué celda queda el hueco en la mezcla presentada.
 */

/** Generador pseudoaleatorio inyectable: devuelve un valor en `[0, 1)`. */
export type SlidingRng = () => number;

/** Rejilla mínima necesaria para saber si un índice es vecino del hueco. */
export interface SlidingGrid {
  cols: number;
  rows: number;
}

/**
 * PRNG determinista (mulberry32). La misma semilla produce siempre la misma
 * secuencia; base de `scramble: "fixed_seed"` (specs/06 §2.5).
 */
export function createSlidingRng(seed: number): SlidingRng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Estado interno de un `sliding_puzzle` (nunca sale al cliente tal cual). */
export interface SlidingPuzzleState {
  /** `locked` si hay `requiresSolved` pendientes; `failed` solo si es definitivo. */
  state: PuzzleState;
  /** Tablero row-major: índice de celda → ficha (`1..N-1`); `0` es el hueco. */
  tiles: number[];
  /** Movimientos válidos aplicados desde la mezcla. */
  moveCount: number;
  solvedAt?: number;
  solvedBy?: string;
}

/** Desenlace de un intento de movimiento. */
export type SlidingMoveOutcome =
  "moved" | "solved" | "not_adjacent" | "unavailable" | "already_solved";

export interface SlidingMoveResult {
  outcome: SlidingMoveOutcome;
  /** Estado resultante (nuevo objeto; `state` de entrada no se muta). */
  state: SlidingPuzzleState;
  /** Índice del hueco tras aplicar el movimiento. */
  blankIndex: number;
}

/**
 * Proyección que viaja al cliente: lo justo para pintar el tablero y el
 * progreso. **No** incluye `seed` ni la disposición resuelta.
 */
export interface SlidingPuzzlePublicView {
  id: string;
  type: "sliding_puzzle";
  state: PuzzleState;
  grid: SlidingGrid;
  imageAsset: string;
  tiles: number[];
  blankIndex: number;
  moveCount: number;
  solvedAt: number | null;
  solvedBy: string | null;
}

/** Número de celdas de la rejilla. */
export function slidingCellCount(def: SlidingPuzzleDefinition): number {
  return def.grid.cols * def.grid.rows;
}

/** Posición resuelta (`[1, 2, …, N-1, 0]`): fichas en orden y hueco al final. */
export function slidingSolvedTiles(def: SlidingPuzzleDefinition): number[] {
  const count = slidingCellCount(def);
  const tiles = new Array<number>(count);
  for (let index = 0; index < count - 1; index += 1) {
    tiles[index] = index + 1;
  }
  tiles[count - 1] = 0;
  return tiles;
}

/** Índice del hueco (`0`) en el tablero, o `-1` si no lo hay. */
export function slidingBlankIndex(tiles: number[]): number {
  return tiles.indexOf(0);
}

/** Vecinos ortogonales válidos de `index` dentro del grid. */
export function slidingNeighborIndices(grid: SlidingGrid, index: number): number[] {
  const { cols, rows } = grid;
  if (index < 0 || index >= cols * rows) return [];
  const col = index % cols;
  const row = Math.floor(index / cols);
  const neighbors: number[] = [];
  if (col > 0) neighbors.push(index - 1);
  if (col < cols - 1) neighbors.push(index + 1);
  if (row > 0) neighbors.push(index - cols);
  if (row < rows - 1) neighbors.push(index + cols);
  return neighbors;
}

/** Inversiones del tablero ignorando el hueco (piezas en orden estricto). */
export function countSlidingInversions(tiles: number[]): number {
  let inversions = 0;
  for (let i = 0; i < tiles.length; i += 1) {
    const left = tiles[i] ?? 0;
    if (left === 0) continue;
    for (let j = i + 1; j < tiles.length; j += 1) {
      const right = tiles[j] ?? 0;
      if (right !== 0 && left > right) inversions += 1;
    }
  }
  return inversions;
}

/**
 * Invariante de paridad estándar del puzle deslizante: `true` si la disposición
 * es alcanzable por movimientos válidos desde la posición resuelta.
 *
 * - Ancho impar: basta con que las inversiones sean pares.
 * - Ancho par: importa la fila del hueco (contada desde abajo), porque la
 *   paridad de la permutación y la del hueco se compensan.
 */
export function isSlidingArrangementSolvable(
  tiles: number[],
  def: SlidingPuzzleDefinition,
): boolean {
  const { cols, rows } = def.grid;
  if (tiles.length !== cols * rows) return false;
  if (cols * rows <= 1) return true;
  const inversions = countSlidingInversions(tiles);
  if (cols % 2 === 1) return inversions % 2 === 0;
  const blank = slidingBlankIndex(tiles);
  if (blank < 0) return false;
  const blankRowFromBottom = rows - Math.floor(blank / cols);
  return (inversions + blankRowFromBottom) % 2 === 1;
}

/** `true` si el tablero coincide con la posición resuelta. */
export function isSlidingPuzzleSolved(
  state: SlidingPuzzleState,
  def: SlidingPuzzleDefinition,
): boolean {
  const goal = slidingSolvedTiles(def);
  return state.tiles.length === goal.length && state.tiles.every((tile, i) => tile === goal[i]);
}

/**
 * Crea el estado inicial. Con `requiresSolved` pendiente arranca `locked`; en
 * cualquier caso el tablero ya viene mezclado de forma determinista (semilla o
 * rng inyectable) y **siempre resoluble**.
 */
export function createSlidingState(
  def: SlidingPuzzleDefinition,
  rng?: SlidingRng,
): SlidingPuzzleState {
  return {
    state: def.requiresSolved.length > 0 ? "locked" : "available",
    tiles: scrambleSlidingTiles(def, rng),
    moveCount: 0,
  };
}

/** Índices de las fichas que pueden deslizarse ahora mismo (las vecinas del hueco). */
export function slidingMovableIndices(
  state: SlidingPuzzleState,
  def: SlidingPuzzleDefinition,
): number[] {
  if (state.state === "solved" || state.state === "locked" || state.state === "failed") return [];
  return slidingNeighborIndices(def.grid, slidingBlankIndex(state.tiles));
}

/** `true` si la ficha de `index` es adyacente al hueco y el puzzle es jugable. */
export function canSlidingMove(
  state: SlidingPuzzleState,
  def: SlidingPuzzleDefinition,
  index: number,
): boolean {
  return slidingMovableIndices(state, def).includes(index);
}

/**
 * Desliza la ficha de `index` hacia el hueco. Devuelve `not_adjacent` sin mutar
 * el estado si la celda no es vecina del hueco; resuelve cuando el tablero
 * queda en orden; es idempotente (un puzzle resuelto no vuelve a jugarse).
 */
export function move(
  state: SlidingPuzzleState,
  def: SlidingPuzzleDefinition,
  index: number,
  now: number,
): SlidingMoveResult {
  const blank = slidingBlankIndex(state.tiles);

  if (state.state === "solved") {
    return { outcome: "already_solved", state, blankIndex: blank };
  }
  if (state.state === "locked" || state.state === "failed") {
    return { outcome: "unavailable", state, blankIndex: blank };
  }
  if (!slidingNeighborIndices(def.grid, blank).includes(index)) {
    return { outcome: "not_adjacent", state, blankIndex: blank };
  }

  const tiles = state.tiles.slice();
  const held = tiles[index] ?? 0;
  tiles[index] = tiles[blank] ?? 0;
  tiles[blank] = held;

  const moved: SlidingPuzzleState = { ...state, tiles, moveCount: state.moveCount + 1 };
  if (isSlidingPuzzleSolved(moved, def)) {
    return {
      outcome: "solved",
      state: { ...moved, state: "solved", solvedAt: now },
      blankIndex: index,
    };
  }
  return {
    outcome: "moved",
    state: state.state === "available" ? { ...moved, state: "in_progress" } : moved,
    blankIndex: index,
  };
}

/** Alias explícito de `move`, por si otro consumidor prefiere el nombre largo. */
export const moveSlidingTile = move;

/** Proyección pública: tablero y progreso, sin `seed` ni la solución. */
export function toSlidingPuzzlePublicView(
  state: SlidingPuzzleState,
  def: SlidingPuzzleDefinition,
): SlidingPuzzlePublicView {
  return {
    id: def.id,
    type: "sliding_puzzle",
    state: state.state,
    grid: { cols: def.grid.cols, rows: def.grid.rows },
    imageAsset: def.imageAsset,
    tiles: state.tiles.slice(),
    blankIndex: slidingBlankIndex(state.tiles),
    moveCount: state.moveCount,
    solvedAt: state.solvedAt ?? null,
    solvedBy: state.solvedBy ?? null,
  };
}

/**
 * Oráculo de solvabilidad del validador (specs/22 §2.3): la disposición inicial
 * es alcanzable por movimientos válidos (invariante de paridad). Un estado ya
 * resuelto siempre es resoluble.
 */
export function isSlidingPuzzleSolvable(
  state: SlidingPuzzleState,
  def: SlidingPuzzleDefinition,
): boolean {
  if (state.state === "solved") return true;
  if (state.state === "failed") return false;
  if (!isCoherentSlidingPuzzleDefinition(def)) return false;
  return isSlidingArrangementSolvable(state.tiles, def);
}

/** `true` si la definición es coherente (grid, imagen y `seed` cuando toca). */
export function isCoherentSlidingPuzzleDefinition(def: SlidingPuzzleDefinition): boolean {
  if (def.grid.cols <= 0 || def.grid.rows <= 0) return false;
  if (def.imageAsset.trim().length === 0) return false;
  if (def.scramble === "fixed_seed" && def.seed === undefined) return false;
  return true;
}

/**
 * Mezcla resoluble: baraja las fichas (sin tocar el hueco) y corrige la
 * paridad con una transposición si hiciera falta. Un resultado "ya resuelto"
 * se rompe con un movimiento válido para que el puzle tenga trabajo.
 */
function scrambleSlidingTiles(def: SlidingPuzzleDefinition, rng?: SlidingRng): number[] {
  const count = slidingCellCount(def);
  const goal = slidingSolvedTiles(def);
  if (count <= 1) return goal;

  const random =
    def.scramble === "fixed_seed" ? createSlidingRng(def.seed ?? 0) : (rng ?? Math.random);
  const blankTarget =
    def.blankPosition === "last" ? count - 1 : Math.floor(random() * count) % count;

  const movable: number[] = [];
  for (let tile = 1; tile < count; tile += 1) movable.push(tile);
  shuffleInPlace(movable, random);

  const tiles = new Array<number>(count).fill(0);
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    if (index === blankTarget) continue;
    tiles[index] = movable[cursor] ?? 0;
    cursor += 1;
  }

  if (!isSlidingArrangementSolvable(tiles, def)) {
    const free: number[] = [];
    for (let index = 0; index < count; index += 1) {
      if (index !== blankTarget) free.push(index);
    }
    if (free.length >= 2) {
      const a = free[0] as number;
      const b = free[1] as number;
      const held = tiles[a] as number;
      tiles[a] = tiles[b] as number;
      tiles[b] = held;
    }
  }

  // La reserva puede caer en la propia posición resuelta (probabilidad ínfima,
  // pero determinista con semilla): un movimiento válido la rompe.
  if (tilesEqual(tiles, goal)) {
    const neighbor = slidingNeighborIndices(def.grid, blankTarget)[0];
    if (neighbor !== undefined) {
      const held = tiles[blankTarget] as number;
      tiles[blankTarget] = tiles[neighbor] as number;
      tiles[neighbor] = held;
    }
  }

  return tiles;
}

/** Fisher-Yates determinista sobre `values` (muta y devuelve el mismo array). */
function shuffleInPlace(values: number[], random: SlidingRng): number[] {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const held = values[i] as number;
    values[i] = values[j] as number;
    values[j] = held;
  }
  return values;
}

function tilesEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((tile, index) => tile === b[index]);
}
