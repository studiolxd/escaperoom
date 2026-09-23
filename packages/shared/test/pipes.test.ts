import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PIPE_EAST,
  PIPE_NORTH,
  PIPE_SOUTH,
  PIPE_WEST,
  computePipesFlow,
  createPipesRng,
  createPipesState,
  isCoherentPipesDefinition,
  isExplicitPipesLayout,
  isPipeRotatable,
  isPipesConnected,
  isPipesSolvable,
  openPipesGate,
  pipeOpenings,
  pipesIndex,
  rotatePipe,
  toPipesPuzzlePublicView,
  type PipesPuzzleState,
} from "../src/templates";
import {
  PipesPuzzleDefinitionSchema,
  RoomPackageSchema,
  type PipesPuzzleDefinition,
} from "../src/schemas";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);

/** `p-canal-agua` tal cual viene en el fixture del Rey Aldric. */
function fixtureDef(): PipesPuzzleDefinition {
  const pkg = RoomPackageSchema.parse(JSON.parse(readFileSync(fixturePath, "utf8")));
  const def = pkg.puzzles.find((puzzle) => puzzle.id === "p-canal-agua");
  if (!def || def.type !== "pipes") throw new Error("el fixture no trae p-canal-agua");
  return def;
}

function makeDef(overrides: Partial<PipesPuzzleDefinition> = {}): PipesPuzzleDefinition {
  return PipesPuzzleDefinitionSchema.parse({
    id: "p-test-tuberias",
    type: "pipes",
    layer: "panel",
    roomId: "catacumbas",
    requiresSolved: [],
    grantsItems: [],
    unlocks: ["altar"],
    grid: { cols: 3, rows: 1 },
    cellTypes: ["straight", "straight", "straight"],
    startCell: { x: 0, y: 0 },
    endCell: { x: 2, y: 0 },
    ...overrides,
  });
}

/**
 * Rota cada celda hasta la orientación de `state.solution` y se detiene en
 * cuanto el agua llega (puede llegar antes: se admiten varias soluciones).
 */
function applySolution(state: PipesPuzzleState, def: PipesPuzzleDefinition) {
  let current = state;
  let outcome: string | null = null;
  state.solution.forEach((target, index) => {
    if (current.state === "solved" || !isPipeRotatable(current, def, index)) return;
    const turns = (target - (current.cells[index]?.rotation ?? 0) + 4) % 4;
    if (turns === 0) return;
    const result = rotatePipe(current, def, index, 100 + index, turns, "p1");
    current = result.state;
    outcome = result.outcome;
  });
  return { state: current, outcome };
}

const gateIndex = (def: PipesPuzzleDefinition) => pipesIndex(def.grid, 3, 2);
const altarIndex = (def: PipesPuzzleDefinition) =>
  pipesIndex(def.grid, def.endCell.x, def.endCell.y);

describe("pipes — geometría", () => {
  it("las piezas rotan en sentido horario", () => {
    expect(pipeOpenings("straight", 0)).toBe(PIPE_NORTH | PIPE_SOUTH);
    expect(pipeOpenings("straight", 1)).toBe(PIPE_EAST | PIPE_WEST);
    expect(pipeOpenings("curve", 0)).toBe(PIPE_NORTH | PIPE_EAST);
    expect(pipeOpenings("curve", 1)).toBe(PIPE_EAST | PIPE_SOUTH);
    expect(pipeOpenings("curve", 3)).toBe(PIPE_WEST | PIPE_NORTH);
    expect(pipeOpenings("tee", 2)).toBe(PIPE_SOUTH | PIPE_WEST | PIPE_NORTH);
    expect(pipeOpenings("cross", 1)).toBe(15);
    expect(pipeOpenings("empty", 2)).toBe(0);
  });

  it("el flood fill exige aberturas enfrentadas en ambas celdas", () => {
    const def = makeDef();
    const state = createPipesState(def, createPipesRng(1));
    const horizontal: PipesPuzzleState = {
      ...state,
      cells: state.cells.map((cell) => ({ ...cell, rotation: 1 })),
    };
    expect(computePipesFlow(horizontal, def)).toEqual([
      { index: 0, depth: 0 },
      { index: 1, depth: 1 },
      { index: 2, depth: 2 },
    ]);
    expect(isPipesConnected(horizontal, def)).toBe(true);

    const broken: PipesPuzzleState = {
      ...horizontal,
      cells: horizontal.cells.map((cell, i) => (i === 1 ? { ...cell, rotation: 0 } : cell)),
    };
    expect(computePipesFlow(broken, def).map((cell) => cell.index)).toEqual([0]);
    expect(isPipesConnected(broken, def)).toBe(false);
  });
});

describe("pipes — p-canal-agua del Rey Aldric", () => {
  it("el fixture es coherente y usa `cellTypes` como paleta", () => {
    const def = fixtureDef();
    expect(isCoherentPipesDefinition(def)).toBe(true);
    expect(isExplicitPipesLayout(def)).toBe(false);
    expect(def.blockedCells).toEqual([{ x: 3, y: 2, opensWithItem: "llave-oro" }]);
  });

  it("el tablero es determinista por id y arranca desordenado y sin agua en el altar", () => {
    const def = fixtureDef();
    const a = createPipesState(def);
    const b = createPipesState(def);
    expect(a).toEqual(b);
    expect(a.state).toBe("available");
    expect(a.cells).toHaveLength(25);
    expect(a.openGates).toEqual([]);
    expect(isPipesConnected(a, def)).toBe(false);
    // Ni siquiera con la compuerta abierta viene resuelto de serie.
    expect(isPipesConnected({ ...a, openGates: [gateIndex(def)] }, def)).toBe(false);
  });

  it("el agua llega al altar con la solución del fixture (y la llave de oro)", () => {
    const def = fixtureDef();
    const initial = createPipesState(def);

    const gate = openPipesGate(initial, def, gateIndex(def), ["llave-oro"], 10, "p1");
    expect(gate.outcome).toBe("opened");

    const { state, outcome } = applySolution(gate.state, def);
    expect(outcome).toBe("solved");
    expect(state.state).toBe("solved");
    expect(state.solvedBy).toBe("p1");
    expect(typeof state.solvedAt).toBe("number");

    const view = toPipesPuzzlePublicView(state, def);
    expect(view.connected).toBe(true);
    expect(view.flow.map((cell) => cell.index)).toContain(altarIndex(def));
    expect(view.flow.map((cell) => cell.index)).toContain(gateIndex(def));
  });

  it("sin `llave-oro` la compuerta bloquea el flujo; con ella, se desbloquea", () => {
    const def = fixtureDef();
    const initial = createPipesState(def);

    // Todas las piezas bien orientadas… pero la compuerta cerrada corta el agua.
    const { state: aligned, outcome } = applySolution(initial, def);
    expect(outcome).toBe("rotated");
    expect(aligned.state).toBe("in_progress");
    expect(isPipesConnected(aligned, def)).toBe(false);
    const dry = toPipesPuzzlePublicView(aligned, def);
    expect(dry.flow.map((cell) => cell.index)).not.toContain(altarIndex(def));
    expect(dry.cells[gateIndex(def)]).toMatchObject({
      gate: "closed",
      openings: 0,
      rotatable: false,
      requiresItem: "llave-oro",
    });

    // No hay rodeo posible: el oráculo solo la da por resoluble con la llave.
    expect(isPipesSolvable(aligned, def)).toBe(false);
    expect(isPipesSolvable(aligned, def, { availableItems: ["llave-plata"] })).toBe(false);
    expect(isPipesSolvable(aligned, def, { availableItems: ["llave-oro"] })).toBe(true);

    // Presentar otra cosa (o nada) no abre la compuerta.
    for (const held of [[], ["llave-plata", "caliz"]]) {
      const attempt = openPipesGate(aligned, def, gateIndex(def), held, 50);
      expect(attempt.outcome).toBe("missing_item");
      expect(attempt.state).toBe(aligned);
    }

    // Con la llave de oro, la compuerta se abre y el agua llega en el acto.
    const opened = openPipesGate(aligned, def, gateIndex(def), ["llave-oro"], 60, "p2");
    expect(opened.outcome).toBe("solved");
    expect(opened.state.openGates).toEqual([gateIndex(def)]);
    expect(opened.state.solvedBy).toBe("p2");
    expect(toPipesPuzzlePublicView(opened.state, def).cells[gateIndex(def)]?.gate).toBe("open");
  });

  it("presentar el objeto fuera de una compuerta, o dos veces, no hace nada", () => {
    const def = fixtureDef();
    const initial = createPipesState(def);
    expect(openPipesGate(initial, def, 0, ["llave-oro"], 1).outcome).toBe("not_a_gate");
    const opened = openPipesGate(initial, def, gateIndex(def), ["llave-oro"], 1).state;
    const again = openPipesGate(opened, def, gateIndex(def), ["llave-oro"], 2);
    expect(again.outcome).toBe("already_open");
    expect(again.state).toBe(opened);
  });

  it("rotaciones inválidas no hacen nada", () => {
    const def = fixtureDef();
    const state = createPipesState(def);
    const rotatable = state.cells.findIndex((_, index) => isPipeRotatable(state, def, index));

    const cases: [number, number, string][] = [
      [-1, 1, "not_rotatable"],
      [25, 1, "not_rotatable"],
      [1.5, 1, "not_rotatable"],
      [Number.NaN, 1, "not_rotatable"],
      [gateIndex(def), 1, "not_rotatable"],
      [rotatable, 0, "invalid_rotation"],
      [rotatable, 4, "invalid_rotation"],
      [rotatable, -1, "invalid_rotation"],
      [rotatable, 1.5, "invalid_rotation"],
    ];
    for (const [index, turns, expected] of cases) {
      const result = rotatePipe(state, def, index, 5, turns);
      expect(result.outcome).toBe(expected);
      expect(result.state).toBe(state);
    }

    // Las rocas (señuelos convertidos para que no se rodee la compuerta) tampoco rotan.
    const rock = state.cells.findIndex(
      (cell, index) => cell.kind === "empty" && index !== gateIndex(def),
    );
    if (rock >= 0) {
      expect(rotatePipe(state, def, rock, 5).outcome).toBe("not_rotatable");
    }

    // Una rotación válida sí cambia la pieza y cuenta.
    const ok = rotatePipe(state, def, rotatable, 5);
    expect(ok.outcome).toBe("rotated");
    expect(ok.state.cells[rotatable]?.rotation).toBe(
      ((state.cells[rotatable]?.rotation ?? 0) + 1) % 4,
    );
    expect(ok.state.rotationCount).toBe(1);
    expect(state.rotationCount).toBe(0);
  });

  it("un puzzle bloqueado o resuelto no acepta rotaciones", () => {
    const def = fixtureDef();
    const locked = createPipesState({ ...def, requiresSolved: ["p-otro"] });
    expect(locked.state).toBe("locked");
    expect(rotatePipe(locked, def, 0, 1).outcome).toBe("unavailable");
    expect(openPipesGate(locked, def, gateIndex(def), ["llave-oro"], 1).outcome).toBe(
      "unavailable",
    );

    const opened = openPipesGate(
      createPipesState(def),
      def,
      gateIndex(def),
      ["llave-oro"],
      1,
    ).state;
    const { state: solved } = applySolution(opened, def);
    const again = rotatePipe(solved, def, 0, 999);
    expect(again.outcome).toBe("already_solved");
    expect(again.state).toBe(solved);
  });

  it("la proyección pública no expone la solución ni la semilla", () => {
    const def = fixtureDef();
    const state = createPipesState(def);
    const view = toPipesPuzzlePublicView(state, def);

    expect(Object.keys(view).sort()).toEqual(
      [
        "cells",
        "connected",
        "endCell",
        "flow",
        "grid",
        "id",
        "rotationCount",
        "solvedAt",
        "solvedBy",
        "startCell",
        "state",
        "type",
      ].sort(),
    );
    const json = JSON.stringify(view);
    expect(json).not.toContain("solution");
    expect(json).not.toContain("seed");
    expect(view.cells.map((cell) => cell.rotation)).toEqual(
      state.cells.map((cell) => cell.rotation),
    );
    // Las rotaciones visibles no coinciden con la solución (tablero desordenado).
    expect(view.cells.map((cell) => cell.rotation)).not.toEqual(state.solution);
  });
});

describe("pipes — tablero explícito y oráculo", () => {
  it("acepta cualquier orientación que conecte (múltiples soluciones)", () => {
    // 3×2: dos rutas posibles de (0,0) a (2,0): la fila de arriba o la de abajo.
    const def = makeDef({
      grid: { cols: 3, rows: 2 },
      cellTypes: ["tee", "straight", "tee", "curve", "straight", "curve"],
      startCell: { x: 0, y: 0 },
      endCell: { x: 2, y: 0 },
    });
    expect(isExplicitPipesLayout(def)).toBe(true);
    const base = createPipesState(def, createPipesRng(7));

    // Ruta superior: T abierta al este, recta horizontal, T abierta al oeste.
    const top: PipesPuzzleState = {
      ...base,
      cells: [
        { kind: "tee", rotation: 0 }, // N E S
        { kind: "straight", rotation: 1 },
        { kind: "tee", rotation: 2 }, // S W N
        { kind: "curve", rotation: 0 },
        { kind: "straight", rotation: 0 },
        { kind: "curve", rotation: 0 },
      ],
    };
    expect(isPipesConnected(top, def)).toBe(true);

    // Ruta inferior: baja, cruza y sube; la recta de arriba queda vertical.
    const bottom: PipesPuzzleState = {
      ...base,
      cells: [
        { kind: "tee", rotation: 0 },
        { kind: "straight", rotation: 0 },
        { kind: "tee", rotation: 2 },
        { kind: "curve", rotation: 0 }, // N E
        { kind: "straight", rotation: 1 },
        { kind: "curve", rotation: 3 }, // W N
      ],
    };
    expect(isPipesConnected(bottom, def)).toBe(true);
    expect(isPipesSolvable(base, def)).toBe(true);
  });

  it("el oráculo detecta un tablero imposible", () => {
    // Todo rectas en diagonal: el agua nunca puede girar hacia (1,1).
    const def = makeDef({
      grid: { cols: 2, rows: 2 },
      cellTypes: ["straight", "straight", "straight", "straight"],
      startCell: { x: 0, y: 0 },
      endCell: { x: 1, y: 1 },
    });
    expect(isPipesSolvable(createPipesState(def, createPipesRng(3)), def)).toBe(false);
  });

  it("respeta `solution` del autor como testigo y un muro permanente corta el paso", () => {
    const def = makeDef({ solution: [[1, 1, 1]] });
    const state = createPipesState(def, createPipesRng(11));
    expect(state.solution).toEqual([1, 1, 1]);
    expect(applySolution(state, def).outcome).toBe("solved");

    const walled = makeDef({ blockedCells: [{ x: 1, y: 0 }] });
    const wallState = createPipesState(walled, createPipesRng(11));
    expect(toPipesPuzzlePublicView(wallState, walled).cells[1]?.gate).toBe("wall");
    expect(isPipesSolvable(wallState, walled, { availableItems: ["llave-oro"] })).toBe(false);
    expect(openPipesGate(wallState, walled, 1, ["llave-oro"], 1).outcome).toBe("not_a_gate");
  });

  it("genera tableros resolubles desde la paleta con cualquier semilla", () => {
    const def = fixtureDef();
    for (let seed = 1; seed <= 25; seed += 1) {
      const state = createPipesState(def, createPipesRng(seed));
      expect(isPipesSolvable(state, def)).toBe(false);
      expect(isPipesSolvable(state, def, { availableItems: ["llave-oro"] })).toBe(true);
      const opened = openPipesGate(state, def, gateIndex(def), ["llave-oro"], 1).state;
      expect(applySolution(opened, def).state.state).toBe("solved");
    }
  });

  it("detecta definiciones incoherentes", () => {
    expect(isCoherentPipesDefinition(makeDef())).toBe(true);
    expect(isCoherentPipesDefinition(makeDef({ endCell: { x: 0, y: 0 } }))).toBe(false);
    expect(isCoherentPipesDefinition(makeDef({ endCell: { x: 5, y: 0 } }))).toBe(false);
    expect(isCoherentPipesDefinition(makeDef({ cellTypes: [] }))).toBe(false);
    expect(isCoherentPipesDefinition(makeDef({ blockedCells: [{ x: 0, y: 0 }] }))).toBe(false);
    expect(isCoherentPipesDefinition(makeDef({ solution: [[0, 0]] }))).toBe(false);
  });
});
