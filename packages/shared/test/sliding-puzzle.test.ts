import { describe, expect, it } from "vitest";
import {
  countSlidingInversions,
  createSlidingRng,
  createSlidingState,
  isCoherentSlidingPuzzleDefinition,
  isSlidingArrangementSolvable,
  isSlidingPuzzleSolved,
  isSlidingPuzzleSolvable,
  move,
  slidingBlankIndex,
  slidingMovableIndices,
  slidingNeighborIndices,
  slidingSolvedTiles,
  toSlidingPuzzlePublicView,
  type SlidingPuzzleState,
} from "../src/templates";
import { SlidingPuzzleDefinitionSchema, type SlidingPuzzleDefinition } from "../src/schemas";

/** `p-mural-vendimia` del Rey Aldric: mural 3×3, semilla 812 (specs/06 §2.5). */
function makeDef(overrides: Partial<SlidingPuzzleDefinition> = {}): SlidingPuzzleDefinition {
  return SlidingPuzzleDefinitionSchema.parse({
    id: "p-mural-vendimia",
    type: "sliding_puzzle",
    layer: "panel",
    roomId: "bodega",
    requiresSolved: [],
    grantsItems: ["llave-plata"],
    unlocks: ["compartimento-plata"],
    grid: { cols: 3, rows: 3 },
    imageAsset: "mural-vendimia-3x3",
    scramble: "fixed_seed",
    seed: 812,
    blankPosition: "last",
    ...overrides,
  });
}

function key(tiles: number[]): string {
  return tiles.join(",");
}

/**
 * Resuelve por BFS (óptimo) desde el tablero actual hasta la posición resuelta
 * y devuelve la secuencia de índices a deslizar. Sirve para comprobar de forma
 * independiente que "el mural 3×3 termina en orden" (specs/22 §2.3).
 */
function solveByBfs(state: SlidingPuzzleState, def: SlidingPuzzleDefinition): number[] {
  const goal = key(slidingSolvedTiles(def));
  const start = key(state.tiles);
  if (start === goal) return [];

  const cameFrom = new Map<string, { prev: string; index: number }>();
  const queue: number[][] = [state.tiles.slice()];
  const seen = new Set<string>([start]);

  for (let head = 0; head < queue.length; head += 1) {
    const tiles = queue[head] as number[];
    const current = key(tiles);
    const blank = slidingBlankIndex(tiles);
    for (const index of slidingNeighborIndices(def.grid, blank)) {
      const next = tiles.slice();
      const held = next[blank] as number;
      next[blank] = next[index] as number;
      next[index] = held;
      const nextKey = key(next);
      if (seen.has(nextKey)) continue;
      seen.add(nextKey);
      cameFrom.set(nextKey, { prev: current, index });
      if (nextKey === goal) {
        const path: number[] = [];
        let cursor = nextKey;
        while (cameFrom.has(cursor)) {
          const step = cameFrom.get(cursor) as { prev: string; index: number };
          path.push(step.index);
          cursor = step.prev;
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return [];
}

describe("sliding_puzzle · estado inicial", () => {
  it("arranca disponible, mezclado y siempre resoluble", () => {
    const def = makeDef();
    const state = createSlidingState(def);

    expect(state.state).toBe("available");
    expect(state.tiles).toHaveLength(9);
    expect(state.moveCount).toBe(0);
    expect(isSlidingArrangementSolvable(state.tiles, def)).toBe(true);
    expect(isSlidingPuzzleSolvable(state, def)).toBe(true);
    // La mezcla no es la posición resuelta.
    expect(isSlidingPuzzleSolved(state, def)).toBe(false);
  });

  it("coloca el hueco al final con `blankPosition: last`", () => {
    const def = makeDef();
    const state = createSlidingState(def);
    expect(slidingBlankIndex(state.tiles)).toBe(8);
  });

  it("con `blankPosition: random` el hueco cae en una celda arbitraria y sigue siendo resoluble", () => {
    const def = makeDef({ blankPosition: "random" });
    const state = createSlidingState(def);
    expect(slidingBlankIndex(state.tiles)).toBeGreaterThanOrEqual(0);
    expect(isSlidingArrangementSolvable(state.tiles, def)).toBe(true);
  });

  it("arranca bloqueado si depende de otro puzzle y no acepta movimientos", () => {
    const def = makeDef({ requiresSolved: ["p-copas-memoria"] });
    const state = createSlidingState(def);
    expect(state.state).toBe("locked");

    const result = move(state, def, 7, 0);
    expect(result.outcome).toBe("unavailable");
    expect(result.state).toBe(state);
  });
});

describe("sliding_puzzle · mezcla determinista", () => {
  it("seed 812 reproduce el MISMO desorden", () => {
    const def = makeDef();
    const first = createSlidingState(def);
    const second = createSlidingState(def);

    expect(first.tiles).toEqual(second.tiles);
    expect(isSlidingPuzzleSolved(first, def)).toBe(false);
  });

  it("semillas distintas producen desórdenes distintos", () => {
    const a = createSlidingState(makeDef({ seed: 812 }));
    const b = createSlidingState(makeDef({ seed: 813 }));
    expect(a.tiles).not.toEqual(b.tiles);
  });

  it("una mezcla aleatoria con rng inyectado conocido es resoluble", () => {
    const def = makeDef({ scramble: "random" });
    for (let seed = 1; seed <= 40; seed += 1) {
      const state = createSlidingState(def, createSlidingRng(seed));
      expect(isSlidingArrangementSolvable(state.tiles, def)).toBe(true);
      expect(isSlidingPuzzleSolvable(state, def)).toBe(true);
    }
  });

  it("la paridad detecta una permutación impar", () => {
    const def = makeDef();
    // Intercambio de dos fichas → inversiones impares → imposible de resolver.
    const unsolvable = [2, 1, 3, 4, 5, 6, 7, 8, 0];
    expect(countSlidingInversions(unsolvable)).toBe(1);
    expect(isSlidingArrangementSolvable(unsolvable, def)).toBe(false);
    expect(isSlidingArrangementSolvable(slidingSolvedTiles(def), def)).toBe(true);
  });

  /** Referencia O(n²) para comprobar el Fenwick de `countSlidingInversions`. */
  function countInversionsBruteForce(tiles: number[]): number {
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

  // Regresión D-1 (auditoría 2026-09-24): `countSlidingInversions` era O(n²);
  // con la rejilla máxima (256×256 = 65 536 celdas) tardaba segundos por
  // llamada. La reescritura con Fenwick debe seguir dando el mismo resultado.
  it("countSlidingInversions coincide con la referencia O(n²) y es rápida a la rejilla máxima", () => {
    const small = [5, 4, 3, 2, 1, 0];
    expect(countSlidingInversions(small)).toBe(countInversionsBruteForce(small));

    const count = 256 * 256;
    const shuffled = Array.from({ length: count }, (_, i) => (i === 0 ? 0 : i)).reverse();
    const start = Date.now();
    const inversions = countSlidingInversions(shuffled);
    expect(Date.now() - start).toBeLessThan(500);
    // Referencia cuadrática solo sobre una muestra más pequeña (sería
    // demasiado lenta a 65 536 elementos): mismo patrón, tablero más chico.
    const sample = Array.from({ length: 2000 }, (_, i) => (i === 0 ? 0 : i)).reverse();
    expect(countSlidingInversions(sample)).toBe(countInversionsBruteForce(sample));
    expect(inversions).toBeGreaterThan(0);
  });
});

describe("sliding_puzzle · jugar", () => {
  it("el mural 3×3 termina en orden deslizando las fichas", () => {
    const def = makeDef();
    const start = createSlidingState(def);
    const path = solveByBfs(start, def);
    expect(path.length).toBeGreaterThan(0);

    let state = start;
    for (let i = 0; i < path.length; i += 1) {
      const result = move(state, def, path[i] as number, 1_000 + i);
      state = result.state;
      if (i < path.length - 1) {
        expect(result.outcome).toBe("moved");
      } else {
        expect(result.outcome).toBe("solved");
      }
    }

    expect(state.state).toBe("solved");
    expect(state.tiles).toEqual(slidingSolvedTiles(def));
    expect(isSlidingPuzzleSolved(state, def)).toBe(true);
    expect(state.solvedAt).toBe(1_000 + path.length - 1);
    expect(state.moveCount).toBe(path.length);
  });

  it("mover una ficha fuera de la fila/columna del hueco no hace nada", () => {
    const def = makeDef();
    const state = createSlidingState(def);
    const blank = slidingBlankIndex(state.tiles); // 8 con blankPosition: last
    expect(blank).toBe(8);

    // Diagonal (0) y a dos celdas (6): ni fila ni columna adyacentes.
    for (const index of [0, 6, blank]) {
      const result = move(state, def, index, 0);
      expect(result.outcome).toBe("not_adjacent");
      expect(result.state).toBe(state);
      expect(result.blankIndex).toBe(blank);
    }
    expect(state.moveCount).toBe(0);
  });

  it("un movimiento válido actualiza hueco, contador y estado", () => {
    const def = makeDef();
    const state = createSlidingState(def);
    const movable = slidingMovableIndices(state, def);
    expect(movable.length).toBeGreaterThan(0);

    const target = movable[0] as number;
    const result = move(state, def, target, 10);
    expect(result.outcome).toBe("moved");
    expect(result.blankIndex).toBe(target);
    expect(result.state.moveCount).toBe(1);
    expect(result.state.state).toBe("in_progress");
    expect(state.moveCount).toBe(0); // lógica pura: no muta la entrada
  });

  it("el estado resuelto es idempotente", () => {
    const def = makeDef();
    const solved: SlidingPuzzleState = {
      state: "solved",
      tiles: slidingSolvedTiles(def),
      moveCount: 12,
      solvedAt: 500,
    };

    const result = move(solved, def, 7, 900);
    expect(result.outcome).toBe("already_solved");
    expect(result.state).toBe(solved);
    expect(result.state.moveCount).toBe(12);
    expect(result.state.solvedAt).toBe(500);
  });
});

describe("sliding_puzzle · proyección pública", () => {
  it("expone el tablero pero no la semilla", () => {
    const def = makeDef();
    const view = toSlidingPuzzlePublicView(createSlidingState(def), def);
    const serialized = JSON.stringify(view);

    expect(view.id).toBe(def.id);
    expect(view.type).toBe("sliding_puzzle");
    expect(view.grid).toEqual({ cols: 3, rows: 3 });
    expect(view.imageAsset).toBe("mural-vendimia-3x3");
    expect(view.tiles).toHaveLength(9);
    expect(view.blankIndex).toBe(8);
    expect(view.solvedAt).toBeNull();
    expect(view).not.toHaveProperty("seed");
    expect(serialized).not.toContain('"seed"');
  });
});

describe("sliding_puzzle · solvencia (validador)", () => {
  it("una definición coherente es resoluble", () => {
    const def = makeDef();
    expect(isCoherentSlidingPuzzleDefinition(def)).toBe(true);
    expect(isSlidingArrangementSolvable(slidingSolvedTiles(def), def)).toBe(true);
  });

  it("`fixed_seed` sin seed no es coherente", () => {
    const def = SlidingPuzzleDefinitionSchema.parse({
      id: "p-mural-vendimia",
      type: "sliding_puzzle",
      layer: "panel",
      roomId: "bodega",
      requiresSolved: [],
      grantsItems: [],
      unlocks: [],
      grid: { cols: 3, rows: 3 },
      imageAsset: "mural-vendimia-3x3",
      scramble: "fixed_seed",
      blankPosition: "last",
    });
    expect(isCoherentSlidingPuzzleDefinition(def)).toBe(false);
    expect(isSlidingPuzzleSolvable(createSlidingState(def), def)).toBe(false);
  });
});
