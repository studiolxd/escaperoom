import type { PipesPuzzleDefinition, PuzzleState } from "../schemas";
import { guardPlayable, initialPuzzleState, publicBase } from "./base";
import { createSlidingRng } from "./sliding-puzzle";

/**
 * Plantilla `pipes` (specs/06 §2.8). Toda la lógica —tablero, rotaciones,
 * compuertas y conectividad— vive aquí, en `shared`: el servidor genera el
 * tablero, aplica cada rotación y calcula con **flood fill** si el agua llega
 * de `startCell` a `endCell`. No se compara con una única solución: cualquier
 * orientación que conecte vale (admite múltiples soluciones).
 *
 * La lógica es pura: `createPipesState`, `rotatePipe` y `openPipesGate` no
 * mutan `state`, devuelven objetos nuevos, así que el host (Colyseus/React)
 * decide cuándo persistirlos, y los tests corren sin infraestructura.
 *
 * **Representación.** Celdas row-major (`index = y * cols + x`). Cada celda
 * lleva una pieza (`straight | curve | tee | cross`, o `empty` = roca sin
 * tubería) y una rotación en cuartos de vuelta en sentido horario (`0..3`).
 * Las aberturas se codifican como máscara de bits (`N=1, E=2, S=4, W=8`).
 *
 * **Tablero.** `cellTypes` admite dos lecturas:
 * - con `cols × rows` entradas es el **tablero explícito** (row-major);
 * - con menos, es la **paleta** de piezas permitidas (así lo usa el Rey
 *   Aldric): el servidor genera un tablero determinista (semilla derivada del
 *   `id`) con un camino garantizado start→end que atraviesa todas las
 *   compuertas, rellena el resto con piezas señuelo y, si alguna permitiera
 *   rodear una compuerta, la convierte en roca: la compuerta es obligatoria.
 *
 * **Compuertas (`blockedCells`).** Sin `opensWithItem` son muro permanente.
 * Con `opensWithItem` son una compuerta cerrada (no deja pasar el agua) que se
 * abre presentando ese objeto (`openPipesGate`); abierta se comporta como un
 * cruce fijo (deja pasar el agua en las cuatro direcciones) y nunca rota.
 *
 * **Anti-trampa.** La proyección pública (`toPipesPuzzlePublicView`) lleva las
 * piezas y rotaciones visibles (lo que el jugador ve en el panel), nunca la
 * `solution` ni la semilla.
 */

/** Pieza de tubería del RoomPackage. */
export type PipeKind = "straight" | "curve" | "tee" | "cross";

/** Pieza de una celda: las del RoomPackage o `empty` (roca, sin tubería). */
export type PipeCellKind = PipeKind | "empty";

/** Generador pseudoaleatorio inyectable: devuelve un valor en `[0, 1)`. */
export type PipesRng = () => number;

/** Dirección cardinal como bit de la máscara de aberturas. */
export const PIPE_NORTH = 1;
export const PIPE_EAST = 2;
export const PIPE_SOUTH = 4;
export const PIPE_WEST = 8;

const DIRECTIONS = [PIPE_NORTH, PIPE_EAST, PIPE_SOUTH, PIPE_WEST] as const;
const ALL_OPENINGS = PIPE_NORTH | PIPE_EAST | PIPE_SOUTH | PIPE_WEST;

/** Aberturas de cada pieza sin rotar (rotación `0`). */
const BASE_OPENINGS: Record<PipeCellKind, number> = {
  straight: PIPE_NORTH | PIPE_SOUTH,
  curve: PIPE_NORTH | PIPE_EAST,
  tee: PIPE_NORTH | PIPE_EAST | PIPE_SOUTH,
  cross: ALL_OPENINGS,
  empty: 0,
};

/** Presupuesto de pasos de la búsqueda exacta del oráculo (grids del MVP: sobra). */
const SEARCH_BUDGET = 1_000_000;
/** Reintentos de generación del tablero a partir de la paleta. */
const GENERATION_ATTEMPTS = 60;

/** Rejilla mínima para indexar celdas. */
export interface PipesGrid {
  cols: number;
  rows: number;
}

/** Celda del tablero: pieza y rotación en cuartos de vuelta horarios. */
export interface PipeCell {
  kind: PipeCellKind;
  rotation: number;
}

/** Estado interno de un `pipes` (nunca sale al cliente tal cual). */
export interface PipesPuzzleState {
  /** `locked` si hay `requiresSolved` pendientes; `failed` solo si es definitivo. */
  state: PuzzleState;
  /** Tablero row-major. */
  cells: PipeCell[];
  /**
   * Una orientación que conecta start→end con todas las compuertas abiertas
   * (solo servidor: testigo para tests y validador; **no** se usa para validar).
   */
  solution: number[];
  /** Índices de las compuertas ya abiertas con su objeto. */
  openGates: number[];
  /** Rotaciones válidas aplicadas. */
  rotationCount: number;
  solvedAt?: number;
  solvedBy?: string;
}

/** Desenlace de un intento de rotación. */
export type PipesRotateOutcome =
  "rotated" | "solved" | "not_rotatable" | "invalid_rotation" | "unavailable" | "already_solved";

/** Desenlace de presentar un objeto en una compuerta. */
export type PipesGateOutcome =
  | "opened"
  | "solved"
  | "missing_item"
  | "not_a_gate"
  | "already_open"
  | "unavailable"
  | "already_solved";

export interface PipesRotateResult {
  outcome: PipesRotateOutcome;
  /** Estado resultante (nuevo objeto; `state` de entrada no se muta). */
  state: PipesPuzzleState;
}

export interface PipesGateResult {
  outcome: PipesGateOutcome;
  state: PipesPuzzleState;
}

/** Estado visible de una celda bloqueada. */
export type PipeGateStatus = "closed" | "open" | "wall";

/** Celda del tablero tal como la ve el cliente. */
export interface PipesCellPublicView {
  index: number;
  x: number;
  y: number;
  kind: PipeCellKind;
  rotation: number;
  /** Aberturas efectivas (máscara `N=1, E=2, S=4, W=8`; compuertas cerradas: `0`). */
  openings: number;
  rotatable: boolean;
  gate: PipeGateStatus | null;
  /** Objeto que abre la compuerta (solo compuertas). */
  requiresItem: string | null;
}

/** Celda alcanzada por el agua y su distancia (en celdas) al origen. */
export interface PipesFlowCell {
  index: number;
  depth: number;
}

/**
 * Proyección que viaja al cliente: lo justo para pintar el panel y animar el
 * agua. **No** incluye `solution` ni la semilla del tablero.
 */
export interface PipesPuzzlePublicView {
  id: string;
  type: "pipes";
  state: PuzzleState;
  grid: PipesGrid;
  startCell: { x: number; y: number };
  endCell: { x: number; y: number };
  cells: PipesCellPublicView[];
  /** Celdas mojadas en orden de flood fill (base de la animación del agua). */
  flow: PipesFlowCell[];
  /** `true` si el agua llega al destino. */
  connected: boolean;
  rotationCount: number;
  solvedAt: number | null;
  solvedBy: string | null;
}

/** Opciones del oráculo de solvabilidad. */
export interface PipesSolvableOptions {
  /** Objetos disponibles en el estado evaluado: abren sus compuertas. */
  availableItems?: readonly string[];
}

// ---------------------------------------------------------------------------
// Geometría
// ---------------------------------------------------------------------------

/** Número de celdas de la rejilla. */
export function pipesCellCount(def: PipesPuzzleDefinition): number {
  return def.grid.cols * def.grid.rows;
}

/** Índice row-major de `(x, y)`, o `-1` si cae fuera del grid. */
export function pipesIndex(grid: PipesGrid, x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return -1;
  if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) return -1;
  return y * grid.cols + x;
}

/** Vecino de `index` en la dirección `direction`, o `-1` si sale del grid. */
export function pipesNeighbor(grid: PipesGrid, index: number, direction: number): number {
  const x = index % grid.cols;
  const y = Math.floor(index / grid.cols);
  if (direction === PIPE_NORTH) return pipesIndex(grid, x, y - 1);
  if (direction === PIPE_EAST) return pipesIndex(grid, x + 1, y);
  if (direction === PIPE_SOUTH) return pipesIndex(grid, x, y + 1);
  if (direction === PIPE_WEST) return pipesIndex(grid, x - 1, y);
  return -1;
}

/** Dirección opuesta (N↔S, E↔W). */
export function pipesOpposite(direction: number): number {
  return rotateMask(direction, 2);
}

/** Aberturas de una pieza con `rotation` cuartos de vuelta horarios. */
export function pipeOpenings(kind: PipeCellKind, rotation: number): number {
  return rotateMask(BASE_OPENINGS[kind], rotation);
}

function rotateMask(mask: number, rotation: number): number {
  const turns = ((rotation % 4) + 4) % 4;
  let result = mask;
  for (let i = 0; i < turns; i += 1) {
    result = ((result << 1) | (result >> 3)) & ALL_OPENINGS;
  }
  return result;
}

/** Primera rotación de `kind` cuyas aberturas cubren `mask`, o `-1`. */
function rotationCovering(kind: PipeCellKind, mask: number): number {
  for (let rotation = 0; rotation < 4; rotation += 1) {
    if ((pipeOpenings(kind, rotation) & mask) === mask) return rotation;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Compuertas
// ---------------------------------------------------------------------------

/** Entrada de `blockedCells` en `index`, si la hay. */
export function pipesBlockedCell(
  def: PipesPuzzleDefinition,
  index: number,
): { x: number; y: number; opensWithItem?: string } | undefined {
  return (def.blockedCells ?? []).find((cell) => pipesIndex(def.grid, cell.x, cell.y) === index);
}

/** Estado de la celda como compuerta (`null` si no está en `blockedCells`). */
export function pipeGateStatus(
  state: PipesPuzzleState,
  def: PipesPuzzleDefinition,
  index: number,
): PipeGateStatus | null {
  const blocked = pipesBlockedCell(def, index);
  if (!blocked) return null;
  if (!blocked.opensWithItem) return "wall";
  return state.openGates.includes(index) ? "open" : "closed";
}

/** Aberturas efectivas de una celda: las compuertas cerradas y los muros no conducen. */
export function pipesEffectiveOpenings(
  state: PipesPuzzleState,
  def: PipesPuzzleDefinition,
  index: number,
): number {
  const gate = pipeGateStatus(state, def, index);
  if (gate === "open") return ALL_OPENINGS;
  if (gate === "closed" || gate === "wall") return 0;
  const cell = state.cells[index];
  return cell ? pipeOpenings(cell.kind, cell.rotation) : 0;
}

/** `true` si la celda admite rotación (pieza con tubería y fuera de `blockedCells`). */
export function isPipeRotatable(
  state: PipesPuzzleState,
  def: PipesPuzzleDefinition,
  index: number,
): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= state.cells.length) return false;
  if (pipesBlockedCell(def, index)) return false;
  return (state.cells[index]?.kind ?? "empty") !== "empty";
}

// ---------------------------------------------------------------------------
// Flood fill
// ---------------------------------------------------------------------------

/**
 * Flood fill desde `startCell`: celdas mojadas en orden BFS con su distancia.
 * Dos celdas vecinas conectan solo si ambas tienen abierta la cara común.
 */
export function computePipesFlow(
  state: PipesPuzzleState,
  def: PipesPuzzleDefinition,
): PipesFlowCell[] {
  const start = pipesIndex(def.grid, def.startCell.x, def.startCell.y);
  if (start < 0 || pipesEffectiveOpenings(state, def, start) === 0) return [];

  const depth = new Map<number, number>([[start, 0]]);
  const flow: PipesFlowCell[] = [{ index: start, depth: 0 }];
  for (let head = 0; head < flow.length; head += 1) {
    const current = flow[head] as PipesFlowCell;
    const openings = pipesEffectiveOpenings(state, def, current.index);
    for (const direction of DIRECTIONS) {
      if ((openings & direction) === 0) continue;
      const next = pipesNeighbor(def.grid, current.index, direction);
      if (next < 0 || depth.has(next)) continue;
      if ((pipesEffectiveOpenings(state, def, next) & pipesOpposite(direction)) === 0) continue;
      depth.set(next, current.depth + 1);
      flow.push({ index: next, depth: current.depth + 1 });
    }
  }
  return flow;
}

/** `true` si el agua llega de `startCell` a `endCell` con el tablero actual. */
export function isPipesConnected(state: PipesPuzzleState, def: PipesPuzzleDefinition): boolean {
  const end = pipesIndex(def.grid, def.endCell.x, def.endCell.y);
  return computePipesFlow(state, def).some((cell) => cell.index === end);
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

/**
 * PRNG determinista (mulberry32, el mismo del `sliding_puzzle`). Por defecto
 * la semilla sale del `id` del puzzle (`pipesSeedFromId`).
 */
export function createPipesRng(seed: number): PipesRng {
  return createSlidingRng(seed);
}

/** Semilla estable (FNV-1a de 32 bits) a partir del `id` del puzzle. */
export function pipesSeedFromId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Crea el estado inicial: tablero (explícito o generado desde la paleta),
 * rotaciones desordenadas y todas las compuertas cerradas. Con
 * `requiresSolved` pendiente arranca `locked`. Sin `rng`, el resultado es
 * determinista por `id` (todos los grupos reciben el mismo tablero).
 */
export function createPipesState(def: PipesPuzzleDefinition, rng?: PipesRng): PipesPuzzleState {
  const random = rng ?? createPipesRng(pipesSeedFromId(def.id));
  const board = isExplicitPipesLayout(def)
    ? explicitBoard(def, random)
    : generateBoard(def, random);

  const cells = board.kinds.map((kind, index) => ({
    kind,
    rotation: isRotatableKind(def, kind, index) ? Math.floor(random() * 4) % 4 : 0,
  }));

  const state: PipesPuzzleState = {
    state: initialPuzzleState(def.requiresSolved),
    cells,
    solution: board.solution,
    openGates: [],
    rotationCount: 0,
  };
  return { ...state, cells: ensureScrambled(state, def, random) };
}

/**
 * Rota la pieza de `index` `turns` cuartos de vuelta horarios (1 por defecto).
 * Rotaciones inválidas —fuera del grid, sobre roca, muro o compuerta, o con
 * `turns` fuera de `1..3`— no hacen nada. Resuelve cuando el agua llega al
 * destino; es idempotente (un puzzle resuelto no vuelve a jugarse).
 */
export function rotatePipe(
  state: PipesPuzzleState,
  def: PipesPuzzleDefinition,
  index: number,
  now: number,
  turns = 1,
  playerId?: string,
): PipesRotateResult {
  const guard = guardPlayable(state.state);
  if (guard !== null) return { outcome: guard, state };
  if (!Number.isInteger(turns) || turns < 1 || turns > 3) {
    return { outcome: "invalid_rotation", state };
  }
  if (!isPipeRotatable(state, def, index)) return { outcome: "not_rotatable", state };

  const cells = state.cells.map((cell, i) =>
    i === index ? { ...cell, rotation: (cell.rotation + turns) % 4 } : cell,
  );
  const rotated: PipesPuzzleState = { ...state, cells, rotationCount: state.rotationCount + 1 };
  if (isPipesConnected(rotated, def)) {
    return { outcome: "solved", state: solve(rotated, now, playerId) };
  }
  return {
    outcome: "rotated",
    state: rotated.state === "available" ? { ...rotated, state: "in_progress" } : rotated,
  };
}

/**
 * Presenta objetos en la compuerta de `index`: si entre `heldItems` está su
 * `opensWithItem`, se abre (el objeto no se consume; eso lo decide el host).
 * Si con la compuerta abierta el agua ya llega, el puzzle se resuelve.
 */
export function openPipesGate(
  state: PipesPuzzleState,
  def: PipesPuzzleDefinition,
  index: number,
  heldItems: readonly string[],
  now: number,
  playerId?: string,
): PipesGateResult {
  const guard = guardPlayable(state.state);
  if (guard !== null) return { outcome: guard, state };

  const blocked = pipesBlockedCell(def, index);
  if (!blocked?.opensWithItem) return { outcome: "not_a_gate", state };
  if (state.openGates.includes(index)) return { outcome: "already_open", state };
  if (!heldItems.includes(blocked.opensWithItem)) return { outcome: "missing_item", state };

  const opened: PipesPuzzleState = { ...state, openGates: [...state.openGates, index] };
  if (isPipesConnected(opened, def)) {
    return { outcome: "solved", state: solve(opened, now, playerId) };
  }
  return { outcome: "opened", state: opened };
}

/** Proyección pública: piezas visibles, compuertas y agua; sin `solution` ni semilla. */
export function toPipesPuzzlePublicView(
  state: PipesPuzzleState,
  def: PipesPuzzleDefinition,
): PipesPuzzlePublicView {
  const flow = computePipesFlow(state, def);
  const end = pipesIndex(def.grid, def.endCell.x, def.endCell.y);
  return {
    ...publicBase(def.id, "pipes", state.state, state.solvedAt, state.solvedBy),
    grid: { cols: def.grid.cols, rows: def.grid.rows },
    startCell: { x: def.startCell.x, y: def.startCell.y },
    endCell: { x: def.endCell.x, y: def.endCell.y },
    cells: state.cells.map((cell, index) => {
      const gate = pipeGateStatus(state, def, index);
      return {
        index,
        x: index % def.grid.cols,
        y: Math.floor(index / def.grid.cols),
        kind: cell.kind,
        rotation: cell.rotation,
        openings: pipesEffectiveOpenings(state, def, index),
        rotatable: isPipeRotatable(state, def, index),
        gate,
        requiresItem: gate ? (pipesBlockedCell(def, index)?.opensWithItem ?? null) : null,
      };
    }),
    flow,
    connected: flow.some((cell) => cell.index === end),
    rotationCount: state.rotationCount,
  };
}

// ---------------------------------------------------------------------------
// Oráculo (validador, specs/22 §2.3)
// ---------------------------------------------------------------------------

/**
 * Oráculo de solvabilidad: existe al menos una orientación de las piezas con
 * la que el agua llega de start a end. Las compuertas cuentan como abiertas si
 * ya lo están en `state` o si su objeto está en `options.availableItems`. Es
 * exacto (búsqueda de camino simple con piezas compatibles), no una
 * aproximación por vecindad.
 */
export function isPipesSolvable(
  state: PipesPuzzleState,
  def: PipesPuzzleDefinition,
  options: PipesSolvableOptions = {},
): boolean {
  if (state.state === "solved") return true;
  if (state.state === "failed") return false;
  if (!isCoherentPipesDefinition(def)) return false;
  const items = options.availableItems ?? [];
  const kinds = state.cells.map((cell, index) => {
    const blocked = pipesBlockedCell(def, index);
    if (!blocked) return cell.kind;
    const passable =
      blocked.opensWithItem !== undefined &&
      (state.openGates.includes(index) || items.includes(blocked.opensWithItem));
    return passable ? "cross" : "empty";
  });
  return findPipesPath(def, kinds) !== null;
}

/**
 * `true` si la definición es coherente: grid positivo, `cellTypes` no vacío,
 * start/end dentro del grid, distintos y fuera de `blockedCells`, compuertas
 * dentro del grid y `solution` (si la hay) con dimensiones `rows × cols`.
 */
export function isCoherentPipesDefinition(def: PipesPuzzleDefinition): boolean {
  const { cols, rows } = def.grid;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) return false;
  if (def.cellTypes.length === 0) return false;
  const start = pipesIndex(def.grid, def.startCell.x, def.startCell.y);
  const end = pipesIndex(def.grid, def.endCell.x, def.endCell.y);
  if (start < 0 || end < 0 || start === end) return false;
  for (const cell of def.blockedCells ?? []) {
    const index = pipesIndex(def.grid, cell.x, cell.y);
    if (index < 0 || index === start || index === end) return false;
  }
  if (def.solution) {
    if (def.solution.length !== rows) return false;
    if (def.solution.some((row) => row.length !== cols)) return false;
  }
  return true;
}

/** `true` si `cellTypes` describe el tablero celda a celda (y no una paleta). */
export function isExplicitPipesLayout(def: PipesPuzzleDefinition): boolean {
  return def.cellTypes.length === pipesCellCount(def);
}

// ---------------------------------------------------------------------------
// Internos
// ---------------------------------------------------------------------------

interface PipesBoard {
  kinds: PipeCellKind[];
  solution: number[];
}

function solve(state: PipesPuzzleState, now: number, playerId?: string): PipesPuzzleState {
  return {
    ...state,
    state: "solved",
    solvedAt: now,
    ...(playerId !== undefined ? { solvedBy: playerId } : {}),
  };
}

function isRotatableKind(def: PipesPuzzleDefinition, kind: PipeCellKind, index: number): boolean {
  return kind !== "empty" && !pipesBlockedCell(def, index);
}

/** Tipos del tablero con las compuertas tratadas como cruce (abiertas) o roca (cerradas). */
function kindsWithGates(
  def: PipesPuzzleDefinition,
  kinds: readonly PipeCellKind[],
  gatesOpen: boolean,
): PipeCellKind[] {
  return kinds.map((kind, index) => {
    const blocked = pipesBlockedCell(def, index);
    if (!blocked) return kind;
    return gatesOpen && blocked.opensWithItem !== undefined ? "cross" : "empty";
  });
}

/** Tablero explícito: tipos de `cellTypes` y solución de `def.solution` o de la búsqueda. */
function explicitBoard(def: PipesPuzzleDefinition, random: PipesRng): PipesBoard {
  const kinds: PipeCellKind[] = def.cellTypes.map((kind, index) => {
    const blocked = pipesBlockedCell(def, index);
    if (!blocked) return kind;
    return blocked.opensWithItem ? "cross" : "empty";
  });
  const fromDef = def.solution?.flat();
  const solution =
    fromDef && fromDef.length === kinds.length
      ? fromDef.map((rotation) => ((rotation % 4) + 4) % 4)
      : kinds.map(() => Math.floor(random() * 4) % 4);
  const path = findPipesPath(def, kindsWithGates(def, kinds, true));
  if (path && !(fromDef && fromDef.length === kinds.length)) {
    for (const step of path) solution[step.index] = step.rotation;
  }
  return { kinds, solution };
}

/**
 * Tablero generado desde la paleta: camino aleatorio start→(compuertas)→end
 * con piezas que encajan, señuelos en el resto y reparación de rodeos.
 */
function generateBoard(def: PipesPuzzleDefinition, random: PipesRng): PipesBoard {
  const count = pipesCellCount(def);
  const palette = [...new Set(def.cellTypes)];
  const hasGates = (def.blockedCells ?? []).some((cell) => cell.opensWithItem !== undefined);
  let fallback: PipesBoard | null = null;
  // Camino con algo de recorrido (no la recta obvia): se exige en la primera
  // mitad de los intentos y luego se acepta cualquiera.
  const straightCells =
    Math.abs(def.endCell.x - def.startCell.x) + Math.abs(def.endCell.y - def.startCell.y) + 1;
  const minCells = Math.min(Math.floor(count / 2), straightCells + 4);

  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    const path = randomPath(def, random);
    if (!path) continue;
    if (attempt < GENERATION_ATTEMPTS / 2 && path.length < minCells) continue;

    const kinds = new Array<PipeCellKind>(count).fill("empty");
    const solution = new Array<number>(count).fill(0);
    const onPath = new Set(path);

    path.forEach((index, step) => {
      const blocked = pipesBlockedCell(def, index);
      if (blocked) {
        kinds[index] = "cross";
        return;
      }
      let mask = 0;
      const prev = path[step - 1];
      const next = path[step + 1];
      if (prev !== undefined) mask |= directionBetween(def.grid, index, prev);
      if (next !== undefined) mask |= directionBetween(def.grid, index, next);
      const kind = pieceFor(mask, palette, random);
      kinds[index] = kind;
      solution[index] = Math.max(0, rotationCovering(kind, mask));
    });

    for (let index = 0; index < count; index += 1) {
      if (onPath.has(index) || pipesBlockedCell(def, index)) continue;
      kinds[index] = pick(palette, random);
      solution[index] = Math.floor(random() * 4) % 4;
    }
    for (const cell of def.blockedCells ?? []) {
      const index = pipesIndex(def.grid, cell.x, cell.y);
      if (index >= 0 && !onPath.has(index)) kinds[index] = cell.opensWithItem ? "cross" : "empty";
    }

    if (!hasGates) return { kinds, solution };

    // Reparación: si el agua pudiera rodear una compuerta cerrada, el señuelo
    // del rodeo se convierte en roca. Si el rodeo solo usa el propio camino,
    // se descarta el intento.
    let repaired = true;
    for (;;) {
      const bypass = findPipesPath(def, kindsWithGates(def, kinds, false));
      if (!bypass) break;
      const decoy = bypass.find((stepCell) => !onPath.has(stepCell.index));
      if (!decoy) {
        repaired = false;
        break;
      }
      kinds[decoy.index] = "empty";
      solution[decoy.index] = 0;
    }
    if (repaired) return { kinds, solution };
    fallback ??= { kinds, solution };
  }

  // Sin camino que cumpla todo (definición degenerada): el mejor intento o, si
  // no hubo ninguno, un tablero de roca (el oráculo lo marcará no resoluble).
  return (
    fallback ?? {
      kinds: new Array<PipeCellKind>(count).fill("empty"),
      solution: new Array<number>(count).fill(0),
    }
  );
}

/** Elige una pieza de la paleta capaz de cubrir `mask` (prefiere recta/curva). */
function pieceFor(mask: number, palette: readonly PipeKind[], random: PipesRng): PipeKind {
  const fits = palette.filter((kind) => rotationCovering(kind, mask) >= 0);
  const simple = fits.filter((kind) => kind === "straight" || kind === "curve");
  const pool = simple.length > 0 ? simple : fits;
  return pool.length > 0 ? pick(pool, random) : "cross";
}

function pick<T>(values: readonly T[], random: PipesRng): T {
  return values[Math.floor(random() * values.length) % values.length] as T;
}

function directionBetween(grid: PipesGrid, from: number, to: number): number {
  for (const direction of DIRECTIONS) {
    if (pipesNeighbor(grid, from, direction) === to) return direction;
  }
  return 0;
}

/**
 * Camino simple aleatorio start → compuertas (por cercanía) → end, evitando
 * muros. DFS con vecinos ordenados por distancia al objetivo más ruido, para
 * caminos con curvas pero sin recorrer medio tablero.
 */
function randomPath(def: PipesPuzzleDefinition, random: PipesRng): number[] | null {
  const start = pipesIndex(def.grid, def.startCell.x, def.startCell.y);
  const end = pipesIndex(def.grid, def.endCell.x, def.endCell.y);
  const gates = (def.blockedCells ?? [])
    .filter((cell) => cell.opensWithItem !== undefined)
    .map((cell) => pipesIndex(def.grid, cell.x, cell.y))
    .filter((index) => index >= 0);
  const walls = new Set(
    (def.blockedCells ?? [])
      .filter((cell) => cell.opensWithItem === undefined)
      .map((cell) => pipesIndex(def.grid, cell.x, cell.y)),
  );

  const waypoints = [start, ...orderByDistance(def.grid, start, gates), end];
  const used = new Set<number>([start]);
  const path = [start];
  for (let i = 1; i < waypoints.length; i += 1) {
    const from = waypoints[i - 1] as number;
    const target = waypoints[i] as number;
    const forbidden = new Set<number>([...walls, ...waypoints.filter((w) => w !== target)]);
    const segment = randomSegment(def.grid, from, target, used, forbidden, random);
    if (!segment) return null;
    for (const index of segment) {
      used.add(index);
      path.push(index);
    }
  }
  return path;
}

function orderByDistance(grid: PipesGrid, from: number, targets: number[]): number[] {
  const distance = (index: number) =>
    Math.abs((index % grid.cols) - (from % grid.cols)) +
    Math.abs(Math.floor(index / grid.cols) - Math.floor(from / grid.cols));
  return [...targets].sort((a, b) => distance(a) - distance(b));
}

/** Segmento (sin `from`, con `target`) por DFS aleatorio sesgado hacia el objetivo. */
function randomSegment(
  grid: PipesGrid,
  from: number,
  target: number,
  used: ReadonlySet<number>,
  forbidden: ReadonlySet<number>,
  random: PipesRng,
): number[] | null {
  const tx = target % grid.cols;
  const ty = Math.floor(target / grid.cols);
  const visited = new Set<number>(used);
  const segment: number[] = [];

  const walk = (current: number): boolean => {
    if (current === target) return true;
    const options = DIRECTIONS.map((direction) => pipesNeighbor(grid, current, direction))
      .filter(
        (next) => next >= 0 && !visited.has(next) && (next === target || !forbidden.has(next)),
      )
      .map((next) => ({
        next,
        score:
          Math.abs((next % grid.cols) - tx) +
          Math.abs(Math.floor(next / grid.cols) - ty) +
          random() * 4,
      }))
      .sort((a, b) => a.score - b.score);
    for (const { next } of options) {
      visited.add(next);
      segment.push(next);
      if (walk(next)) return true;
      segment.pop();
    }
    return false;
  };

  return walk(from) ? segment : null;
}

/**
 * Búsqueda exacta de un camino simple start→end en el que cada pieza puede
 * orientarse para unir su entrada con su salida. Devuelve la rotación de cada
 * celda del camino, o `null`. Primero descarta por vecindad (barato).
 */
function findPipesPath(
  def: PipesPuzzleDefinition,
  kinds: readonly PipeCellKind[],
): { index: number; rotation: number }[] | null {
  const { grid } = def;
  const start = pipesIndex(grid, def.startCell.x, def.startCell.y);
  const end = pipesIndex(grid, def.endCell.x, def.endCell.y);
  if (start < 0 || end < 0) return null;
  if ((kinds[start] ?? "empty") === "empty" || (kinds[end] ?? "empty") === "empty") return null;
  if (!reachableIgnoringShapes(grid, kinds, start, end)) return null;

  let budget = SEARCH_BUDGET;
  const visited = new Set<number>([start]);
  const steps: { index: number; rotation: number }[] = [];

  const walk = (current: number, entry: number): boolean => {
    budget -= 1;
    if (budget < 0) return false;
    const kind = kinds[current] ?? "empty";
    if (current === end) {
      const rotation = rotationCovering(kind, entry);
      if (rotation < 0) return false;
      steps.push({ index: current, rotation });
      return true;
    }
    for (const direction of DIRECTIONS) {
      if (direction === entry) continue;
      const rotation = rotationCovering(kind, entry | direction);
      if (rotation < 0) continue;
      const next = pipesNeighbor(grid, current, direction);
      if (next < 0 || visited.has(next) || (kinds[next] ?? "empty") === "empty") continue;
      visited.add(next);
      steps.push({ index: current, rotation });
      if (walk(next, pipesOpposite(direction))) return true;
      steps.pop();
      visited.delete(next);
    }
    return false;
  };

  return walk(start, 0) ? steps : null;
}

function reachableIgnoringShapes(
  grid: PipesGrid,
  kinds: readonly PipeCellKind[],
  start: number,
  end: number,
): boolean {
  const seen = new Set<number>([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head] as number;
    if (current === end) return true;
    for (const direction of DIRECTIONS) {
      const next = pipesNeighbor(grid, current, direction);
      if (next < 0 || seen.has(next) || (kinds[next] ?? "empty") === "empty") continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/**
 * Garantiza que el tablero presentado no conecte ya (ni siquiera con todas las
 * compuertas abiertas): si conectara, gira piezas del camino testigo.
 */
function ensureScrambled(
  state: PipesPuzzleState,
  def: PipesPuzzleDefinition,
  random: PipesRng,
): PipeCell[] {
  const gates = (def.blockedCells ?? [])
    .filter((cell) => cell.opensWithItem !== undefined)
    .map((cell) => pipesIndex(def.grid, cell.x, cell.y));
  let cells = state.cells;
  const candidates = cells
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell, index }) => isRotatableKind(def, cell.kind, index) && cell.kind !== "cross")
    .map(({ index }) => index);
  if (candidates.length === 0) return cells;

  for (let tries = 0; tries < 4 * candidates.length; tries += 1) {
    if (!isPipesConnected({ ...state, cells, openGates: gates }, def)) return cells;
    const target = pick(candidates, random);
    cells = cells.map((cell, index) =>
      index === target ? { ...cell, rotation: (cell.rotation + 1) % 4 } : cell,
    );
  }
  return cells;
}
