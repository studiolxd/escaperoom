import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PUZZLE_TYPES_MVP,
  parseRoomPackage,
  type PuzzleDefinition,
  type PuzzleType,
  type RoomPackage,
} from "@escaperoom/shared/schemas";
import { describe, expect, it } from "vitest";
import type * as Y from "yjs";
import {
  InspectorError,
  PUZZLE_BASE_KEYS,
  findField,
  roomDocToPackage,
  roomPackageToDoc,
} from "../src";
import {
  PREVIEW_PLAYER_ID,
  applyTemplatePreview,
  checkTemplateConfig,
  combineItemsStartingInventory,
  createTemplatePreview,
  describeTemplateConfig,
  isTemplatePreviewSolved,
  setTemplateConfig,
  templateConfigKeys,
  type TemplatePreview,
  type TemplatePreviewAction,
} from "../src/template-config";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const fixture: RoomPackage = parseRoomPackage(
  JSON.parse(readFileSync(fixturePath, "utf8")) as unknown,
);

function puzzleOf<T extends PuzzleType>(
  pkg: RoomPackage,
  type: T,
): Extract<PuzzleDefinition, { type: T }> {
  const puzzle = pkg.puzzles.find((p) => p.type === type);
  if (!puzzle) throw new Error(`el fixture no trae un ${type}`);
  return puzzle as Extract<PuzzleDefinition, { type: T }>;
}

function readPuzzle(doc: Y.Doc, id: string): PuzzleDefinition {
  const puzzle = roomDocToPackage(doc).puzzles.find((p) => p.id === id);
  if (!puzzle) throw new Error(`no existe ${id}`);
  return puzzle;
}

function without(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
}

function play(preview: TemplatePreview, ...actions: TemplatePreviewAction[]): TemplatePreview {
  return actions.reduce((current, action) => applyTemplatePreview(current, action, 1_000), preview);
}

describe("configuradores de plantillas (3.5) — esquema", () => {
  it("las claves de configuración son las propias de cada plantilla, derivadas del esquema", () => {
    for (const type of PUZZLE_TYPES_MVP) {
      const keys = templateConfigKeys(type);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys).not.toContain("type");
      for (const base of PUZZLE_BASE_KEYS) expect(keys).not.toContain(base);
    }
    expect(templateConfigKeys("code_lock")).toEqual([
      "length",
      "code",
      "maxAttempts",
      "lockoutSec",
      "hints",
    ]);
    expect(templateConfigKeys("pipes")).toContain("blockedCells");
  });

  it("el formulario sale del esquema con las referencias a otros elementos", () => {
    const plates = describeTemplateConfig("simultaneous_plates");
    expect(plates.fields?.map((f) => f.key)).toEqual(templateConfigKeys("simultaneous_plates"));
    expect(findField(plates, "plates.*.objectId")?.ref).toBe("object");
    expect(findField(plates, "soloBridgeItemId")?.ref).toBe("item");
    expect(findField(plates, "holdMode")?.options).toEqual(["press", "stand"]);
    expect(findField(describeTemplateConfig("code_lock"), "hints.*")?.ref).toBe("hint");
    expect(findField(describeTemplateConfig("pipes"), "blockedCells.*.opensWithItem")?.ref).toBe(
      "item",
    );
  });
});

/** Un cambio de configuración por plantilla, con su valor nuevo. */
const CHANGES: Record<PuzzleType, (p: PuzzleDefinition) => { key: string; value: unknown }> = {
  hidden_key: () => ({ key: "revealAnimation", value: "fade" }),
  code_lock: () => ({ key: "code", value: "9021" }),
  simultaneous_plates: () => ({ key: "windowMs", value: 1500 }),
  combine_items: (p) => ({
    key: "recipes",
    value: [
      ...(p.type === "combine_items" ? p.recipes : []),
      { inputs: ["antorcha", "pergamino-bodega"], output: "llave-bronce", consumeInputs: true },
    ],
  }),
  sliding_puzzle: () => ({ key: "grid", value: { cols: 4, rows: 3 } }),
  memory: () => ({ key: "maxFlipsPerTurn", value: 3 }),
  split_clue: () => ({ key: "inputUI", value: "code" }),
  pipes: () => ({ key: "endCell", value: { x: 4, y: 4 } }),
};

describe("configuradores de plantillas (3.5) — escritura en el doc Yjs", () => {
  it.each(PUZZLE_TYPES_MVP)(
    "%s: un cambio en el configurador se refleja en roomDocToPackage",
    (type) => {
      const doc = roomPackageToDoc(fixture);
      const puzzle = puzzleOf(fixture, type);
      const { key, value } = CHANGES[type](puzzle);
      setTemplateConfig(doc, puzzle, key, value);
      const after = readPuzzle(doc, puzzle.id) as unknown as Record<string, unknown>;
      expect(after[key]).toEqual(value);
      // El resto del puzzle no cambia.
      expect(without(after, key)).toEqual(without(puzzle, key));
    },
  );

  it("un campo opcional se quita con undefined y los campos comunes no pasan por el configurador", () => {
    const doc = roomPackageToDoc(fixture);
    const lock = puzzleOf(fixture, "code_lock");
    setTemplateConfig(doc, lock, "maxAttempts", undefined);
    expect(readPuzzle(doc, lock.id)).not.toHaveProperty("maxAttempts");
    expect(() => setTemplateConfig(doc, lock, "roomId", "bodega")).toThrow(InspectorError);
    expect(() => setTemplateConfig(doc, lock, "type", "memory")).toThrow(InspectorError);
  });
});

describe("configuradores de plantillas (3.5) — aviso del oráculo", () => {
  it("las 8 plantillas del Rey Aldric son resolubles", () => {
    for (const puzzle of fixture.puzzles) expect(checkTemplateConfig(puzzle)).toEqual({ ok: true });
  });

  it("un candado con un código que no casa con la longitud no es resoluble", () => {
    const lock = { ...puzzleOf(fixture, "code_lock"), code: "47A2" };
    expect(checkTemplateConfig(lock)).toMatchObject({ ok: false, issue: "unsolvable" });
    expect(checkTemplateConfig({ ...lock, code: "473" })).toMatchObject({ ok: false });
  });

  it("un deslizante con semilla fija sin semilla, o sin imagen, no es resoluble", () => {
    const sliding = puzzleOf(fixture, "sliding_puzzle");
    const noSeed = without(sliding, "seed") as unknown as PuzzleDefinition;
    expect(checkTemplateConfig(noSeed)).toMatchObject({
      ok: false,
      issue: "unsolvable",
      type: "sliding_puzzle",
    });
    expect(checkTemplateConfig({ ...sliding, imageAsset: " " })).toMatchObject({ ok: false });
  });

  it("unas tuberías sin camino (muro sin compuerta) no son resolubles; con compuerta sí", () => {
    const pipes = puzzleOf(fixture, "pipes");
    const wall = [0, 1, 2, 3, 4].map((y) => ({ x: 2, y }));
    expect(checkTemplateConfig({ ...pipes, blockedCells: wall })).toMatchObject({
      ok: false,
      issue: "unsolvable",
      type: "pipes",
    });
    const gated = wall.map((cell) =>
      cell.y === 2 ? { ...cell, opensWithItem: "llave-oro" } : cell,
    );
    expect(checkTemplateConfig({ ...pipes, blockedCells: gated })).toEqual({ ok: true });
  });

  it("una configuración que no cumple el esquema señala los campos", () => {
    const lock = puzzleOf(fixture, "code_lock");
    const broken = { ...lock, length: "cuatro" } as unknown as PuzzleDefinition;
    expect(checkTemplateConfig(broken)).toEqual({
      ok: false,
      issue: "schema",
      type: "code_lock",
      paths: ["length"],
    });
  });

  it("el aviso llega en cuanto el configurador escribe en el doc", () => {
    const doc = roomPackageToDoc(fixture);
    const pipes = puzzleOf(fixture, "pipes");
    setTemplateConfig(
      doc,
      pipes,
      "blockedCells",
      [0, 1, 2, 3, 4].map((y) => ({ x: 1, y })),
    );
    expect(checkTemplateConfig(readPuzzle(doc, pipes.id))).toMatchObject({ ok: false });
  });
});

describe("configuradores de plantillas (3.5) — vista previa jugable en local", () => {
  it("arranca disponible aunque dependa de otros puzzles", () => {
    const split = puzzleOf(fixture, "split_clue");
    expect(split.requiresSolved).not.toEqual([]);
    const preview = createTemplatePreview(split);
    expect(preview.state.state).toBe("available");
  });

  it("code_lock: el código configurado lo resuelve; uno erróneo no", () => {
    const lock = puzzleOf(fixture, "code_lock");
    const wrong = play(createTemplatePreview(lock), { type: "attempt_code", code: "0000" });
    expect(wrong.feedback).toBe("wrong");
    const solved = play(wrong, { type: "attempt_code", code: lock.code });
    expect(solved.feedback).toBe("correct");
    expect(isTemplatePreviewSolved(solved)).toBe(true);
  });

  it("hidden_key: revelar el escondite lo resuelve", () => {
    const preview = play(createTemplatePreview(puzzleOf(fixture, "hidden_key")), {
      type: "reveal",
    });
    expect(preview.feedback).toBe("revealed");
    expect(isTemplatePreviewSolved(preview)).toBe(true);
  });

  it("simultaneous_plates: pisar todas las placas a la vez lo resuelve", () => {
    const plates = puzzleOf(fixture, "simultaneous_plates");
    const preview = play(
      createTemplatePreview(plates),
      ...plates.plates.map((plate): TemplatePreviewAction => ({
        type: "toggle_plate",
        objectId: plate.objectId,
        active: true,
      })),
    );
    expect(isTemplatePreviewSolved(preview)).toBe(true);
  });

  it("combine_items: se empieza con los ingredientes base y aplicar las recetas lo resuelve", () => {
    const combine = puzzleOf(fixture, "combine_items");
    expect(combineItemsStartingInventory(combine).sort()).toEqual(
      ["llave-plata", "mechero", "vela"].sort(),
    );
    const preview = play(
      createTemplatePreview(combine),
      ...combine.recipes.map((recipe): TemplatePreviewAction => ({
        type: "combine",
        inputs: recipe.inputs,
      })),
    );
    expect(isTemplatePreviewSolved(preview)).toBe(true);
  });

  it("sliding_puzzle: solo se mueven las fichas vecinas del hueco", () => {
    const sliding = createTemplatePreview(puzzleOf(fixture, "sliding_puzzle"));
    if (sliding.type !== "sliding_puzzle") throw new Error("tipo");
    const blank = sliding.state.tiles.indexOf(0);
    const far = sliding.state.tiles.findIndex(
      (_, index) =>
        Math.abs((index % 3) - (blank % 3)) +
          Math.abs(Math.floor(index / 3) - Math.floor(blank / 3)) >
        1,
    );
    expect(play(sliding, { type: "slide", index: far }).feedback).toBe("not_adjacent");
    const near = blank % 3 > 0 ? blank - 1 : blank + 1;
    const moved = play(sliding, { type: "slide", index: near });
    expect(moved.feedback).toBe("moved");
    expect(moved.state.state).toBe("in_progress");
  });

  it("memory: voltear cada pareja lo resuelve", () => {
    const start = createTemplatePreview(puzzleOf(fixture, "memory"));
    if (start.type !== "memory") throw new Error("tipo");
    const bySymbol = new Map<string, string[]>();
    for (const card of start.state.cards) {
      bySymbol.set(card.symbol, [...(bySymbol.get(card.symbol) ?? []), card.id]);
    }
    const flips = [...bySymbol.values()].flatMap((ids) =>
      ids.map((cardId): TemplatePreviewAction => ({ type: "flip", cardId })),
    );
    expect(isTemplatePreviewSolved(play(start, ...flips))).toBe(true);
  });

  it("split_clue: se cambia de mirilla y la combinación completa lo resuelve", () => {
    const split = puzzleOf(fixture, "split_clue");
    const start = createTemplatePreview(split);
    const other = play(start, { type: "select_viewpoint", viewpointId: "mirilla-b" });
    expect(other.type === "split_clue" && other.viewpointId).toBe("mirilla-b");
    const solved = play(other, { type: "submit_clue", combination: split.fragments });
    expect(solved.feedback).toBe("correct");
    expect(isTemplatePreviewSolved(solved)).toBe(true);
  });

  it("pipes: el creador lleva los objetos de las compuertas y girar piezas avanza", () => {
    const pipes = puzzleOf(fixture, "pipes");
    const start = createTemplatePreview(pipes);
    if (start.type !== "pipes") throw new Error("tipo");
    const gate = pipes.blockedCells![0]!;
    const opened = play(start, { type: "open_gate", index: gate.y * pipes.grid.cols + gate.x });
    expect(opened.feedback).toBe("opened");
    const rotatable = start.state.cells.findIndex(
      (cell, index) => cell.kind !== "empty" && index !== gate.y * pipes.grid.cols + gate.x,
    );
    expect(["rotated", "solved"]).toContain(
      play(opened, { type: "rotate_pipe", index: rotatable }).feedback,
    );
  });

  it("una intención que no es de la plantilla no cambia nada", () => {
    const preview = createTemplatePreview(puzzleOf(fixture, "code_lock"));
    expect(play(preview, { type: "flip", cardId: "x" })).toBe(preview);
    expect(PREVIEW_PLAYER_ID).toBe("editor-preview");
  });
});
