import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseRoomPackage,
  PuzzleDefinitionSchema,
  type PuzzleDefinition,
  type RoomPackage,
  type SimultaneousPlatesDefinition,
  type SplitClueDefinition,
} from "../src/schemas";
import { createRoomSession } from "../src/session";
import {
  allPlatesActive,
  createSimultaneousPlatesState,
  createSplitClueState,
  placeSoloBridge,
  placeSplitClueBridge,
  setPlateActive,
  submitCombination,
  toSplitCluePublicView,
  type SimultaneousPlatesState,
  type SplitClueState,
} from "../src/templates";
import {
  validateRoomPackage,
  type ValidationCheckId,
  type ValidationReport,
} from "../src/validator";

/**
 * Modo solitario verificado (ticket 2.10, specs/22 §2.1; comportamiento de
 * consumo actualizado en 2.11): cada mecánica cooperativa que declara
 * `soloBridgeItemId` se completa con 1 jugador usando su objeto-puente, y sin
 * él no. Desde 2.11 el puente **se gasta** al fijarse (un objeto, un uso,
 * como cualquier otro ítem de un escape room), igual que en `RoomSession`.
 * Como el inventario no admite copias duplicadas del mismo ítem (`grantItem`
 * es idempotente), un objeto-puente consumible solo puede cubrir 1 placa que
 * falte por jugador ausente. Niveles:
 *
 * - **validador**: el test de solvabilidad con `players.min = 1` sobre el Rey
 *   Aldric y sobre un paquete mínimo por cada plantilla cooperativa;
 * - **plantilla**: un jugador solitario simulado (una placa o una mirilla a la
 *   vez) resuelve cada mecánica con su puente y se queda atascado sin él;
 * - **motor**: la misma partida en `RoomSession` sobre el paquete mínimo.
 *
 * Los tests se derivan de los datos (puzzles con `soloBridgeItemId`, esquemas
 * con el campo, catálogo de plantillas) para no depender de ids concretos del
 * fixture, que puede evolucionar (2.8).
 */

const root = new URL("../../../", import.meta.url);
const fixturePath = fileURLToPath(new URL("docs/reference/roompackage-rey-aldric.v1.json", root));
const catalogPath = fileURLToPath(new URL("docs/reference/catalogo-plantillas.md", root));

const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

function checkOf(report: ValidationReport, id: ValidationCheckId) {
  const check = report.checks.find((candidate) => candidate.id === id);
  if (!check) throw new Error(`falta el check ${id}`);
  return check;
}

function soloIssues(report: ValidationReport) {
  return checkOf(report, "solvability").issues.filter(
    (issue) => issue.code === "solo_bridge_missing",
  );
}

/** Id del objeto-puente de un puzzle, si lo declara. */
function bridgeOf(puzzle: PuzzleDefinition): string | undefined {
  return "soloBridgeItemId" in puzzle ? puzzle.soloBridgeItemId : undefined;
}

/** Copia del puzzle sin objeto-puente. */
function withoutBridge<T extends PuzzleDefinition>(puzzle: T): T {
  const copy = structuredClone(puzzle);
  if ("soloBridgeItemId" in copy) delete copy.soloBridgeItemId;
  return copy;
}

// ---------------------------------------------------------------------------
// Jugador solitario simulado (nivel plantilla)
// ---------------------------------------------------------------------------

/**
 * Un jugador solitario solo ocupa una placa a la vez: recorre las placas en
 * orden, se sube a cada una y (en `stand`) se baja al irse. El trayecto entre
 * placas dura más que `windowMs` (placas separadas, como en el Rey Aldric:
 * 8 casillas frente a 800 ms), así que en `press` la pulsación anterior caduca.
 * Con puente, lo coloca antes en la primera placa.
 */
function soloWalkPlates(
  def: SimultaneousPlatesDefinition,
  useBridge: boolean,
): { state: SimultaneousPlatesState; bridgeOutcome: string | null } {
  const travelMs = def.windowMs + 1;
  // Los `requiresSolved` ya están resueltos: el host desbloquea el puzzle.
  let state: SimultaneousPlatesState = {
    ...createSimultaneousPlatesState(def),
    state: "available",
  };
  let now = 0;
  let bridgeOutcome: string | null = null;
  if (useBridge) {
    const result = placeSoloBridge(state, def, now, def.plates[0]!.objectId, "solo");
    bridgeOutcome = result.outcome;
    state = result.state;
  }
  for (const plate of def.plates) {
    if (state.state === "solved") break;
    if (state.plates[plate.objectId]?.bridged) continue;
    state = setPlateActive(state, def, plate.objectId, true, now, "solo").state;
    if (state.state === "solved") break;
    if (def.holdMode === "stand") {
      state = setPlateActive(state, def, plate.objectId, false, now, "solo").state;
    }
    now += travelMs;
  }
  return { state, bridgeOutcome };
}

/**
 * Un jugador solitario mira por una sola mirilla a la vez: solo conoce lo que
 * el servidor le proyecta para ese punto de vista y envía lo que ve. Con
 * puente, coloca el espejo antes (y su vista pasa a ser la unión).
 */
function soloReadSplitClue(
  def: SplitClueDefinition,
  useBridge: boolean,
): {
  state: SplitClueState;
  bridgeOutcome: string | null;
  outcomes: string[];
  complete: boolean;
} {
  // Los `requiresSolved` ya están resueltos: el host desbloquea el puzzle.
  let state: SplitClueState = { ...createSplitClueState(def), state: "available" };
  let bridgeOutcome: string | null = null;
  if (useBridge) {
    const result = placeSplitClueBridge(state, def, "solo");
    bridgeOutcome = result.outcome;
    state = result.state;
  }
  const outcomes: string[] = [];
  let complete = false;
  for (const viewpoint of def.viewpoints) {
    const view = toSplitCluePublicView(state, def, viewpoint.objectId);
    const seen = view.visible.filter((fragment): fragment is string => fragment !== null);
    complete ||= seen.length === def.fragments.length;
    const input = def.inputUI === "code" ? seen.join("") : seen;
    const result = submitCombination(state, def, input, 0, "solo");
    outcomes.push(result.outcome);
    state = result.state;
    if (state.state === "solved") break;
  }
  return { state, bridgeOutcome, outcomes, complete };
}

/** `true` si el jugador solitario simulado resuelve la mecánica. */
function solvesSolo(puzzle: PuzzleDefinition, useBridge: boolean): boolean {
  switch (puzzle.type) {
    case "simultaneous_plates":
      return soloWalkPlates(puzzle, useBridge).state.state === "solved";
    case "split_clue":
      return soloReadSplitClue(puzzle, useBridge).state.state === "solved";
    default:
      throw new Error(`sin jugador solitario simulado para ${puzzle.type}`);
  }
}

/**
 * Partida en solitario en el motor (`RoomSession`, el mismo que usa el
 * servidor de 2.8): el jugador recoge el puente del cofre, se mueve por la
 * sala y, si `useBridge`, lo usa sobre la primera placa/mirilla. Devuelve si
 * la partida acaba en victoria y el inventario final.
 */
function playSoloSession(
  pkg: RoomPackage,
  useBridge: boolean,
): { victory: boolean; solved: boolean; inventory: string[] } {
  const puzzle = pkg.puzzles[0]!;
  const session = createRoomSession(pkg, { playerIds: ["p1"], timeLimitSec: 600 });
  let now = 0;
  const tick = (): number => (now += 1000);
  session.start(tick());
  session.movePlayer("p1", "sala", 5, 8, tick());
  session.interact("cofre", tick(), "p1");
  expect(session.inventory("p1")).toContain(BRIDGE);

  switch (puzzle.type) {
    case "simultaneous_plates": {
      const [first, ...rest] = puzzle.plates;
      session.movePlayer("p1", "sala", first!.x, first!.y, tick());
      if (useBridge) session.useItemOnObject(BRIDGE, first!.objectId, tick(), "p1");
      for (const plate of rest) session.movePlayer("p1", "sala", plate.x, plate.y, tick());
      break;
    }
    case "split_clue": {
      for (const [i, viewpoint] of puzzle.viewpoints.entries()) {
        if (session.isPuzzleSolved(puzzle.id)) break;
        session.movePlayer("p1", "sala", viewpoint.zone.x, viewpoint.zone.y, tick());
        expect(session.viewpointOf(puzzle.id, "p1")).toBe(viewpoint.objectId);
        if (useBridge && i === 0) {
          session.useItemOnObject(BRIDGE, viewpoint.objectId, tick(), "p1");
        }
        const seen = session
          .splitClueView(puzzle.id, "p1")
          .visible.filter((fragment): fragment is string => fragment !== null);
        session.submitSplitClue(
          puzzle.id,
          puzzle.inputUI === "code" ? seen.join("") : seen,
          tick(),
          "p1",
        );
      }
      break;
    }
    default:
      throw new Error(`sin partida en solitario para ${puzzle.type}`);
  }
  return {
    victory: session.state.result === "victory",
    solved: session.isPuzzleSolved(puzzle.id),
    inventory: session.inventory("p1"),
  };
}

// ---------------------------------------------------------------------------
// Paquetes mínimos por plantilla cooperativa
// ---------------------------------------------------------------------------

const BRIDGE = "objeto-puente";

/** Un puzzle cooperativo de prueba por plantilla con `soloBridgeItemId`. */
const COOPERATIVE_PUZZLES: Record<string, () => PuzzleDefinition> = {
  simultaneous_plates: () =>
    PuzzleDefinitionSchema.parse({
      id: "p-coop",
      type: "simultaneous_plates",
      layer: "world",
      roomId: "sala",
      requiresSolved: [],
      grantsItems: [],
      unlocks: [],
      plates: [
        { objectId: "coop-a", x: 1, y: 5 },
        { objectId: "coop-b", x: 8, y: 5 },
      ],
      windowMs: 800,
      holdMode: "stand",
      soloBridgeItemId: BRIDGE,
    }),
  split_clue: () =>
    PuzzleDefinitionSchema.parse({
      id: "p-coop",
      type: "split_clue",
      layer: "world",
      roomId: "sala",
      requiresSolved: [],
      grantsItems: [],
      unlocks: [],
      viewpoints: [
        { objectId: "coop-a", zone: { x: 1, y: 4, w: 2, h: 2 } },
        { objectId: "coop-b", zone: { x: 7, y: 4, w: 2, h: 2 } },
      ],
      fragments: ["1", "2", "3", "4"],
      visibleByViewpoint: { "coop-a": ["1", null, "3", null], "coop-b": [null, "2", null, "4"] },
      wallOccluder: { x: 4, y: 3, w: 2, h: 4 },
      soloBridgeItemId: BRIDGE,
      inputUI: "code",
    }),
};

function worldObject(id: string, x: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    roomId: "sala",
    type: "decorativo",
    position: { x, y: 5 },
    sprite: id,
    states: {},
    initialState: "",
    interactable: true,
    ...extra,
  };
}

/**
 * Sala mínima: un cofre con el objeto-puente, el puzzle cooperativo y una
 * regla de victoria al resolverlo.
 */
function soloPackage(puzzle: PuzzleDefinition, players = { min: 1, max: 2 }): RoomPackage {
  return parseRoomPackage({
    meta: {
      id: `room-solo-${puzzle.type}`,
      title: `Solitario ${puzzle.type}`,
      authorId: "test",
      version: "1.0.0",
      packageFormat: "1",
      theme: "medieval",
      description: "Paquete de prueba del modo solitario",
      languages: ["es"],
      defaultLanguage: "es",
      estimatedMinutes: 10,
      difficulty: 1,
      players,
      assetsManifest: "r2://assets/packs/medieval-v1/manifest.json",
    },
    map: {
      tileset: "medieval-v1",
      rooms: [
        {
          id: "sala",
          name: "Sala",
          grid: { cols: 10, rows: 10 },
          layers: [],
          decorations: [],
          spawnPoints: [{ id: "spawn-1", x: 5, y: 8 }],
          lighting: [],
        },
      ],
    },
    objects: [
      worldObject("cofre", 5, { hidingSpot: { contains: BRIDGE } }),
      worldObject("coop-a", 1),
      worldObject("coop-b", 8),
    ],
    items: [{ id: BRIDGE, name: { es: { text: "Objeto-puente" } }, icon: "icon-puente" }],
    puzzles: [puzzle],
    rules: [
      {
        id: "r-victoria",
        priority: 1,
        once: true,
        trigger: { type: "on_puzzle_solved", puzzleId: puzzle.id },
        conditions: [],
        actions: [{ type: "end_game", result: "victory" }],
      },
    ],
    dialogs: [],
    hints: [],
  });
}

/** Tipos de puzzle cuyo esquema admite `soloBridgeItemId` (plantillas cooperativas). */
function cooperativeTypesFromSchema(): string[] {
  return PuzzleDefinitionSchema.options
    .filter((option) => "soloBridgeItemId" in option.shape)
    .map((option) => option.shape.type.value as string)
    .sort();
}

/**
 * Plantillas cooperativas del catálogo (tabla MVP): las que mencionan el
 * objeto-puente (`soloBridgeItemId` o "puente") en su fila.
 */
function cooperativeTypesFromCatalog(): string[] {
  const catalog = readFileSync(catalogPath, "utf8");
  const mvp = catalog.split("## MVP")[1]!.split("\n## ")[0]!;
  return mvp
    .split("\n")
    .filter((line) => line.startsWith("|") && /soloBridgeItemId|puente/iu.test(line))
    .map((line) => /`([a-z_]+)`/u.exec(line)?.[1])
    .filter((type): type is string => type !== undefined)
    .sort();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("modo solitario — validador sobre el Rey Aldric (players.min = 1)", () => {
  const bridged = reyAldric.puzzles.filter((puzzle) => bridgeOf(puzzle) !== undefined);
  const report = validateRoomPackage(reyAldric, { playerCounts: [1] });

  it("el Rey Aldric admite 1 jugador y declara puentes para placas y mirillas", () => {
    expect(reyAldric.meta.players.min).toBe(1);
    expect(bridged.map((puzzle) => puzzle.type).sort()).toEqual(
      expect.arrayContaining(["simultaneous_plates", "split_clue"]),
    );
  });

  it("es solvable en solitario, sin errores ni avisos de puente", () => {
    expect(report.ok).toBe(true);
    expect(report.solvability).toHaveLength(1);
    expect(report.solvability[0]).toMatchObject({
      playerCount: 1,
      solvable: true,
      searchTruncated: false,
      blocked: [],
    });
    expect(checkOf(report, "solvability")).toMatchObject({ status: "ok", passed: true });
    expect(checkOf(report, "dead_ends")).toMatchObject({ status: "ok", passed: true });
    expect(soloIssues(report)).toEqual([]);
    // La validación por defecto (players.min..max) también cubre el solitario.
    expect(validateRoomPackage(reyAldric).solvability[0]).toMatchObject({
      playerCount: 1,
      solvable: true,
    });
  });

  it("la ruta en solitario usa el puente de cada mecánica cooperativa, tras conseguirlo", () => {
    const route = report.criticalRoute!;
    expect(route.playerCount).toBe(1);
    expect(route.steps[route.steps.length - 1]!.victory).toBe(true);

    for (const puzzle of bridged) {
      const bridge = bridgeOf(puzzle)!;
      const solvedAt = route.steps.findIndex((step) => step.puzzlesSolved.includes(puzzle.id));
      expect(solvedAt, `${puzzle.id} no se resuelve en la ruta`).toBeGreaterThanOrEqual(0);
      const step = route.steps[solvedAt]!;
      // El puente se gasta al fijarse (2.11), mismo criterio que `RoomSession`.
      expect(step.itemsConsumed, `${puzzle.id} no gasta ${bridge}`).toEqual([bridge]);
      expect(step.description).toContain(`${bridge}`);
      expect(step.description).toContain("(puente)");
      const gainedAt = route.steps.findIndex((candidate) => candidate.itemsGained.includes(bridge));
      expect(gainedAt, `${bridge} no se consigue antes de ${puzzle.id}`).toBeGreaterThanOrEqual(0);
      expect(gainedAt).toBeLessThan(solvedAt);
    }
  });

  it("en grupo las mecánicas cooperativas no usan (ni gastan) el puente", () => {
    const group = validateRoomPackage(reyAldric, { playerCounts: [2] });
    expect(group.ok).toBe(true);
    for (const puzzle of bridged) {
      const step = group.criticalRoute!.steps.find((candidate) =>
        candidate.puzzlesSolved.includes(puzzle.id),
      )!;
      expect(step.itemsConsumed).toEqual([]);
    }
  });

  it.each(
    reyAldric.puzzles.filter((puzzle) => bridgeOf(puzzle) !== undefined).map((p) => [p.id, p]),
  )("sin el puente de %s, el validador lo marca como error en solitario", (id, puzzle) => {
    const pkg = structuredClone(reyAldric);
    pkg.puzzles = pkg.puzzles.map((candidate) =>
      candidate.id === id ? withoutBridge(candidate) : candidate,
    );

    const solo = validateRoomPackage(pkg);
    expect(solo.ok).toBe(false);
    expect(solo.solvability.find((result) => result.playerCount === 1)!.solvable).toBe(false);
    expect(checkOf(solo, "solvability").status).toBe("error");
    const issues = soloIssues(solo);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ ids: [id], playerCounts: [1] });
    expect(issues[0]!.message).toContain(`«${id}» (${puzzle.type}) es cooperativo`);
    expect(issues[0]!.message).toContain("no declara soloBridgeItemId");
    expect(issues[0]!.message).toContain("sube players.min a 2");

    // Con players.min = 2 no hace falta puente: la sala es válida.
    pkg.meta.players.min = 2;
    const group = validateRoomPackage(pkg);
    expect(group.ok).toBe(true);
    expect(soloIssues(group)).toEqual([]);
  });
});

describe("modo solitario — plantillas cooperativas del Rey Aldric", () => {
  const plates = reyAldric.puzzles.find(
    (puzzle): puzzle is SimultaneousPlatesDefinition =>
      puzzle.type === "simultaneous_plates" && puzzle.soloBridgeItemId !== undefined,
  )!;
  const peepholes = reyAldric.puzzles.find(
    (puzzle): puzzle is SplitClueDefinition =>
      puzzle.type === "split_clue" && puzzle.soloBridgeItemId !== undefined,
  )!;

  it("placas: un jugador con el cáliz en una placa y de pie en la otra las resuelve", () => {
    const { state, bridgeOutcome } = soloWalkPlates(plates, true);
    expect(bridgeOutcome).toBe("activated");
    expect(state.state).toBe("solved");
    expect(state.plates[plates.plates[0]!.objectId]!.bridged).toBe(true);
  });

  it("placas: sin el puente, un jugador solo nunca las tiene todas activas", () => {
    const def = withoutBridge(plates);
    const { state } = soloWalkPlates(def, true);
    expect(state.state).not.toBe("solved");
    expect(allPlatesActive(state, def, 0)).toBe(false);
    // Tampoco se puede colocar un puente que la definición no declara.
    const available: SimultaneousPlatesState = {
      ...createSimultaneousPlatesState(def),
      state: "available",
    };
    expect(placeSoloBridge(available, def, 0).outcome).toBe("unavailable");
    // Y con el modo `press` tampoco: la pulsación caduca en el trayecto.
    expect(solvesSolo({ ...def, holdMode: "press" }, false)).toBe(false);
    expect(solvesSolo({ ...plates, holdMode: "press" }, true)).toBe(true);
  });

  it("mirillas: con el espejo, un jugador ve la pista completa y la resuelve", () => {
    const { state, bridgeOutcome, outcomes, complete } = soloReadSplitClue(peepholes, true);
    expect(bridgeOutcome).toBe("bridged");
    expect(complete).toBe(true);
    expect(outcomes[0]).toBe("correct");
    expect(state.state).toBe("solved");
  });

  it("mirillas: sin el espejo, ninguna mirilla sola basta para resolverla", () => {
    const def = withoutBridge(peepholes);
    const { state, bridgeOutcome, outcomes, complete } = soloReadSplitClue(def, true);
    expect(bridgeOutcome).toBe("unavailable");
    expect(complete).toBe(false);
    expect(outcomes.every((outcome) => outcome !== "correct")).toBe(true);
    expect(state.state).not.toBe("solved");
  });
});

describe("modo solitario — toda plantilla cooperativa del catálogo", () => {
  const types = cooperativeTypesFromSchema();

  it("las plantillas con soloBridgeItemId coinciden con las cooperativas del catálogo", () => {
    expect(types).toEqual(["simultaneous_plates", "split_clue"]);
    expect(cooperativeTypesFromCatalog()).toEqual(types);
  });

  it.each(types)("%s tiene un puzzle de prueba para el modo solitario", (type) => {
    expect(
      COOPERATIVE_PUZZLES[type],
      `añade un puzzle de prueba de ${type} a COOPERATIVE_PUZZLES`,
    ).toBeDefined();
    expect(COOPERATIVE_PUZZLES[type]!().type).toBe(type);
  });

  it.each(types)("%s con puente es resoluble en solitario (validador y plantilla)", (type) => {
    const puzzle = COOPERATIVE_PUZZLES[type]!();
    const report = validateRoomPackage(soloPackage(puzzle));

    expect(report.ok).toBe(true);
    expect(report.solvability.map((result) => [result.playerCount, result.solvable])).toEqual([
      [1, true],
      [2, true],
    ]);
    const route = report.criticalRoute!;
    expect(route.playerCount).toBe(1);
    const step = route.steps.find((candidate) => candidate.puzzlesSolved.includes(puzzle.id))!;
    expect(step.itemsConsumed).toEqual([BRIDGE]);
    expect(route.steps[route.steps.length - 1]!.victory).toBe(true);

    expect(solvesSolo(puzzle, true)).toBe(true);
  });

  it.each(types)("%s: en el motor, un jugador gana con el puente y lo gasta al fijarlo", (type) => {
    const played = playSoloSession(soloPackage(COOPERATIVE_PUZZLES[type]!()), true);
    expect(played).toMatchObject({ victory: true, solved: true });
    expect(played.inventory).not.toContain(BRIDGE);
  });

  it.each(types)("%s: en el motor, sin puente declarado un jugador no lo resuelve", (type) => {
    const played = playSoloSession(soloPackage(withoutBridge(COOPERATIVE_PUZZLES[type]!())), true);
    expect(played).toMatchObject({ victory: false, solved: false });
  });

  it.each(types)("%s sin puente con players.min = 1 es un error claro", (type) => {
    const puzzle = withoutBridge(COOPERATIVE_PUZZLES[type]!());
    const report = validateRoomPackage(soloPackage(puzzle));

    expect(report.ok).toBe(false);
    expect(report.solvability.map((result) => [result.playerCount, result.solvable])).toEqual([
      [1, false],
      [2, true],
    ]);
    const solvability = checkOf(report, "solvability");
    expect(solvability.status).toBe("error");
    expect(soloIssues(report)).toEqual([
      {
        code: "solo_bridge_missing",
        message: expect.stringContaining(`«p-coop» (${type}) es cooperativo`) as unknown as string,
        ids: ["p-coop"],
        playerCounts: [1],
      },
    ]);
    expect(solvesSolo(puzzle, false)).toBe(false);

    // Sala solo para grupos: la misma mecánica sin puente es válida.
    expect(validateRoomPackage(soloPackage(puzzle, { min: 2, max: 4 })).ok).toBe(true);
  });

  it("el aviso aparece aunque la victoria llegue por otro camino", () => {
    const puzzle = withoutBridge(COOPERATIVE_PUZZLES.simultaneous_plates!());
    const pkg = soloPackage(puzzle);
    // Una regla alternativa gana al inspeccionar el cofre: la sala es
    // solvable en solitario, pero las placas siguen sin poder resolverse.
    pkg.rules.push({
      id: "r-atajo",
      priority: 2,
      once: true,
      trigger: { type: "on_interact", objectId: "cofre" },
      conditions: [],
      actions: [{ type: "end_game", result: "victory" }],
    });

    const report = validateRoomPackage(pkg, { playerCounts: [1] });
    expect(report.solvability[0]!.solvable).toBe(true);
    expect(report.ok).toBe(false);
    const solvability = checkOf(report, "solvability");
    expect(solvability.status).toBe("error");
    expect(solvability.summary).toBe(
      "Solvabilidad: la sala admite 1 jugador, pero p-coop no declara(n) objeto-puente",
    );
    expect(soloIssues(report)).toHaveLength(1);
  });

  it("un objeto-puente consumible cubre como mucho 1 placa que falte (se gasta al fijarse)", () => {
    const puzzle = COOPERATIVE_PUZZLES.simultaneous_plates!();
    if (puzzle.type !== "simultaneous_plates") throw new Error("tipo inesperado");
    puzzle.plates = [...puzzle.plates, { objectId: "coop-c", x: 5, y: 2 }];
    const pkg = soloPackage(puzzle, { min: 1, max: 3 });
    pkg.objects.push(worldObject("coop-c", 5) as RoomPackage["objects"][number]);

    const report = validateRoomPackage(pkg);
    // Con 1 jugador faltan 2 placas: un único objeto-puente (no se duplica en
    // el inventario) ya no basta desde que se gasta al fijarse (2.11).
    expect(report.solvability.map((result) => [result.playerCount, result.solvable])).toEqual([
      [1, false],
      [2, true],
      [3, true],
    ]);
    expect(report.ok).toBe(false);
    const issue = checkOf(report, "solvability").issues.find((candidate) =>
      candidate.ids.includes("p-coop"),
    )!;
    expect(issue.message).toContain("un objeto-puente consumible solo cubre 1");
    expect(issue.message).toContain("no admite copias duplicadas");

    // Con 2 jugadores falta 1 sola placa: el mismo puente la cubre y se gasta.
    const group = validateRoomPackage(pkg, { playerCounts: [2] });
    expect(group.ok).toBe(true);
    const step = group.criticalRoute!.steps.find((candidate) =>
      candidate.puzzlesSolved.includes("p-coop"),
    )!;
    expect(step.itemsConsumed).toEqual([BRIDGE]);
  });

  it("unas placas de una sola placa no son cooperativas y no piden puente", () => {
    const puzzle = withoutBridge(COOPERATIVE_PUZZLES.simultaneous_plates!());
    if (puzzle.type !== "simultaneous_plates") throw new Error("tipo inesperado");
    puzzle.plates = puzzle.plates.slice(0, 1);
    const report = validateRoomPackage(soloPackage(puzzle));
    expect(report.ok).toBe(true);
    expect(soloIssues(report)).toEqual([]);
    expect(solvesSolo(puzzle, false)).toBe(true);
  });
});
