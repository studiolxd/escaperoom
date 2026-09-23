import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EngineResult } from "../src/engine";
import { parseRoomPackage, type PipesPuzzleDefinition } from "../src/schemas";
import { createRoomSession, type RoomSession } from "../src/session";
import { createPipesState, slidingNeighborIndices } from "../src/templates";

/**
 * Integración **Rey Aldric completo** (ticket 2.8): las 3 salas, las 8
 * plantillas conectadas a `RoomSession` (el núcleo autoritativo que ejecuta
 * `GameRoom`), sin navegador ni red. Recorre la ruta crítica de 14 pasos de
 * `docs/reference/rey-aldric-notas-diseno.md` y termina en `victory`.
 *
 * Los "jugadores de test" solo usan lo que un cliente real ve: vistas públicas
 * (`*View`) y los símbolos que el servidor revela al voltear. Las únicas
 * "soluciones" que conocen son las del propio fixture (códigos que el jugador
 * descubre en la sala) y el testigo determinista del tablero de `pipes`, que
 * el test recalcula con la plantilla igual que haría un jugador probando.
 */

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const room = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

const PLACA_IZQ = { x: 6, y: 11 };
const PLACA_DER = { x: 14, y: 11 };
const MIRILLA_A = { x: 9, y: 10 };
const MIRILLA_B = { x: 13, y: 10 };
const PIPES_GATE_INDEX = 2 * 5 + 3; // compuerta de oro en (3,2) de un 5×5

/** Reglas que la ruta crítica dispara exactamente una vez (notas de diseño, "Uso como fixture"). */
const ONCE_RULES = [
  "r-inicio",
  "r-inspeccionar-cuadro",
  "r-revelar-cuadro",
  "r-abrir-armario",
  "r-encender-brasero",
  "r-abrir-arca",
  "r-leer-pergamino",
  "r-placas-resueltas",
  "r-mural-resuelto",
  "r-caliz-en-ranura",
  "r-copas-resueltas",
  "r-entrar-catacumbas",
  "r-canal-resuelto",
  "r-inspeccionar-sarcofago",
  "r-inspeccionar-vasijas",
  "r-sello-resuelto",
] as const;

/** Reloj lógico del guion: cada paso avanza un segundo. */
class Clock {
  t = 0;
  next(): number {
    this.t += 1000;
    return this.t;
  }
}

interface Script {
  session: RoomSession;
  clock: Clock;
  fired: string[];
  dialogs: string[];
  record: (result: EngineResult | null | undefined) => void;
}

function newScript(playerIds: string[]): Script {
  const session = createRoomSession(room, { playerIds, timeLimitSec: 3600 });
  const fired: string[] = [];
  const dialogs: string[] = [];
  const record = (result: EngineResult | null | undefined): void => {
    if (!result) return;
    fired.push(...result.fired.map((rule) => rule.ruleId));
    for (const effect of result.effects) {
      if (effect.type === "show_dialog") dialogs.push(effect.dialogId);
    }
  };
  const clock = new Clock();
  record(session.start(clock.t));
  for (const playerId of playerIds) record(session.spawnPlayer(playerId, clock.t).engine);
  return { session, clock, fired, dialogs, record };
}

/** Tablero del mural codificado en base 10 (≤ 9 celdas: cabe en un `number`). */
function encode(board: readonly number[]): number {
  return board.reduce((key, tile) => key * 10 + tile, 0);
}

const slidingMemo = new Map<string, number[]>();

/**
 * BFS sobre la vista pública del mural: devuelve los índices a deslizar. Se
 * memoiza por tablero (con `seed 812` todos los tests parten del mismo).
 */
function solveSliding(tiles: number[], cols: number, rows: number): number[] {
  const memoKey = `${cols}x${rows}:${tiles.join(",")}`;
  const cached = slidingMemo.get(memoKey);
  if (cached) return cached;

  const goal = encode([...Array.from({ length: cols * rows - 1 }, (_, i) => i + 1), 0]);
  const start = encode(tiles);
  const previous = new Map<number, { from: number; move: number } | null>([[start, null]]);
  const boards = new Map<number, number[]>([[start, tiles.slice()]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const key = queue[head]!;
    if (key === goal) break;
    const board = boards.get(key)!;
    boards.delete(key);
    const blank = board.indexOf(0);
    for (const index of slidingNeighborIndices({ cols, rows }, blank)) {
      const next = board.slice();
      next[blank] = next[index]!;
      next[index] = 0;
      const nextKey = encode(next);
      if (previous.has(nextKey)) continue;
      previous.set(nextKey, { from: key, move: index });
      boards.set(nextKey, next);
      queue.push(nextKey);
    }
  }
  const moves: number[] = [];
  for (let step = previous.get(goal); step; step = previous.get(step.from)) {
    moves.unshift(step.move);
  }
  slidingMemo.set(memoKey, moves);
  return moves;
}

function solveMural(script: Script, playerId: string): void {
  const { session, clock, record } = script;
  const view = session.slidingView("p-mural-vendimia");
  for (const index of solveSliding(view.tiles, view.grid.cols, view.grid.rows)) {
    const moved = session.moveSlidingTile("p-mural-vendimia", index, clock.next(), playerId);
    expect(["moved", "solved"]).toContain(moved.outcome);
    record(moved.engine);
  }
  expect(session.isPuzzleSolved("p-mural-vendimia")).toBe(true);
}

/**
 * Juega el `memory` como un grupo real: recuerda los símbolos que el servidor
 * revela al voltear y empareja en cuanto conoce una pareja. `players` se turnan.
 */
function solveMemory(script: Script, players: string[]): void {
  const { session, clock, record } = script;
  const known = new Map<string, string>();
  let turn = 0;
  const flip = (cardId: string): string | null => {
    const playerId = players[turn % players.length]!;
    const result = session.flipMemoryCard("p-copas-memoria", cardId, clock.next(), playerId);
    record(result.engine);
    if (result.revealedSymbol) known.set(cardId, result.revealedSymbol);
    if (result.outcome === "match" || result.outcome === "mismatch") turn += 1;
    return result.revealedSymbol;
  };

  for (let guard = 0; guard < 50 && !session.isPuzzleSolved("p-copas-memoria"); guard += 1) {
    const view = session.memoryView("p-copas-memoria");
    // El cliente nunca recibe el símbolo de una carta boca abajo.
    for (const card of view.cards) {
      if (!card.flipped) expect(card.symbol).toBeNull();
    }
    const hidden = view.cards.filter((card) => !card.matched).map((card) => card.id);
    const pair = hidden.flatMap((a) =>
      hidden
        .filter((b) => b !== a && known.get(a) && known.get(a) === known.get(b))
        .map((b) => [a, b]),
    )[0];
    if (pair) {
      flip(pair[0]!);
      flip(pair[1]!);
      continue;
    }
    const unknown = hidden.filter((id) => !known.has(id));
    const symbol = flip(unknown[0]!);
    const partner = hidden.find((id) => id !== unknown[0] && known.get(id) === symbol);
    flip(partner ?? unknown[1]!);
  }
  expect(session.isPuzzleSolved("p-copas-memoria")).toBe(true);
}

/** Testigo determinista del tablero (mismo `id` ⇒ mismo tablero que el servidor). */
function pipesWitness(): number[] {
  const def = room.puzzles.find((puzzle) => puzzle.id === "p-canal-agua") as PipesPuzzleDefinition;
  return createPipesState(def).solution;
}

/** Orienta las piezas hacia el testigo; se detiene si el agua llega antes. */
function rotateCanal(script: Script, playerId: string): void {
  const { session, clock, record } = script;
  const witness = pipesWitness();
  for (const cell of session.pipesView("p-canal-agua").cells) {
    if (session.isPuzzleSolved("p-canal-agua")) return;
    if (!cell.rotatable) continue;
    const turns = (((witness[cell.index]! - cell.rotation) % 4) + 4) % 4;
    if (turns === 0) continue;
    const rotated = session.rotatePipe("p-canal-agua", cell.index, clock.next(), playerId, turns);
    record(rotated.engine);
  }
}

/** Pasos 1–5: Salón del Trono hasta abrir el arca (los hace `p1`). */
function playSalonHastaArca(script: Script): void {
  const { session, clock, record } = script;
  // 1. Inspeccionar el cuadro → llave-bronce
  record(session.interact("cuadro-aurelio", clock.next(), "p1").engine);
  expect(session.inventory("p1")).toContain("llave-bronce");
  // 2. Abrir el armario con la llave → mechero + vela
  record(session.useItemOnObject("llave-bronce", "armario", clock.next(), "p1").engine);
  expect(session.inventory("p1")).toEqual(expect.arrayContaining(["mechero", "vela"]));
  // 3. Combinar mechero + vela → antorcha
  record(session.combine("p-combina", ["mechero", "vela"], clock.next(), "p1").engine);
  expect(session.inventory("p1")).toContain("antorcha");
  // 4. Encender el brasero → dígito 3 visible
  record(session.interact("brasero", clock.next(), "p1").engine);
  expect(session.flag("digito3")).toBe(3);
  // 5. Candado del arca "4732" → cáliz + busto de piedra + pergamino
  const arca = session.attemptCode("p-candado-arca", "4732", clock.next(), "p1");
  expect(arca.outcome).toBe("correct");
  record(arca.engine);
  expect(session.inventory("p1")).toEqual(
    expect.arrayContaining(["caliz-real", "busto-piedra", "pergamino-bodega"]),
  );
}

/** Pasos 7–10 en la Bodega (mural, llave dentro de la llave, ranura, copas). */
function playBodega(script: Script, muralist: string, memoryPlayers: string[]): void {
  const { session, clock, record } = script;
  // 7. Mural 3×3 (seed 812) → compartimento → llave-plata
  solveMural(script, muralist);
  expect(session.objectState("compartimento-plata")).toBe("open");
  expect(session.flag("digito2")).toBe(5);
  expect(session.inventory(muralist)).toContain("llave-plata");
  // 8. Inspeccionar la llave-plata → llave-oro (sin consumirla)
  const inspected = session.combine("p-combina", ["llave-plata"], clock.next(), muralist);
  expect(inspected.result.outcome).toBe("combined");
  record(inspected.engine);
  expect(session.inventory(muralist)).toEqual(expect.arrayContaining(["llave-plata", "llave-oro"]));
  // 9. Cáliz en la ranura del mural (lore) y recuperarlo (r-recoger-caliz)
  record(session.interact("mural-ranura", clock.next(), "p1").engine);
  expect(session.inventory("p1")).toContain("caliz-real");
  // 10. Copas de memoria (3 pares) → dígito 3 + antorchas de la escalera
  solveMemory(script, memoryPlayers);
  expect(session.objectState("mesa-catas")).toBe("active");
  expect(session.flag("digito3-copas")).toBe(3);
}

/** Pasos 12–14 en las Catacumbas: canal, vasijas/sarcófago y sello final. */
function playCatacumbas(script: Script, keyHolder: string): void {
  const { session, clock, record } = script;
  // 12. Canal de tuberías: la compuerta de oro se abre con la llave-oro
  const gate = session.openPipesGate("p-canal-agua", PIPES_GATE_INDEX, clock.next(), keyHolder);
  expect(["opened", "solved"]).toContain(gate.outcome);
  record(gate.engine);
  rotateCanal(script, keyHolder);
  expect(session.isPuzzleSolved("p-canal-agua")).toBe(true);
  expect(session.objectState("altar")).toBe("flowing");
  // 13. Vasijas (dígito 8) y sarcófago (recuerdo del código)
  record(session.interact("vasijas", clock.next(), "p1").engine);
  record(session.interact("sarcofago", clock.next(), "p1").engine);
  expect(session.flag("digito4")).toBe(8);
  // 14. Sello final "4538" → relicario → VICTORIA (tras el `delay` de 4 s)
  const sello = session.attemptCode("p-sello-final", "4538", clock.next(), "p1");
  expect(sello.outcome).toBe("correct");
  record(sello.engine);
  expect(session.objectState("relicario")).toBe("open");
  expect(session.state.result).toBeUndefined();
  record(session.tick(clock.t + 4000));
}

describe("integración — Rey Aldric completo (2 jugadores)", () => {
  it("la ruta crítica de 14 pasos termina en victoria", () => {
    const script = newScript(["p1", "p2"]);
    const { session, clock, record, fired, dialogs } = script;

    playSalonHastaArca(script);

    // 6. Placas simultáneas: un jugador en cada placa → puerta a la Bodega
    expect(session.movePlayer("p2", "bodega", 9, 2, clock.next()).outcome).toBe("room_locked");
    record(session.movePlayer("p1", "salon-trono", PLACA_IZQ.x, PLACA_IZQ.y, clock.next()).engine);
    expect(session.isPuzzleSolved("p-placas-estatuas")).toBe(false);
    expect(session.objectState("placa-izq")).toBe("down");
    const plates = session.movePlayer("p2", "salon-trono", PLACA_DER.x, PLACA_DER.y, clock.next());
    record(plates.engine);
    expect(plates.plates.at(-1)?.outcome).toBe("solved");
    expect(session.objectState("puerta-bodega")).toBe("open");

    for (const playerId of ["p1", "p2"]) {
      expect(session.movePlayer(playerId, "bodega", 9, 2, clock.next()).outcome).toBe("moved");
    }

    playBodega(script, "p2", ["p1", "p2"]);

    // 11. Mirillas: cada jugador ve solo su mitad; juntos resuelven
    expect(session.puzzleState("p-reja-mirillas")).toBe("available");
    record(session.movePlayer("p1", "bodega", MIRILLA_A.x, MIRILLA_A.y, clock.next()).engine);
    record(session.movePlayer("p2", "bodega", MIRILLA_B.x, MIRILLA_B.y, clock.next()).engine);
    const viewA = session.splitClueView("p-reja-mirillas", "p1");
    const viewB = session.splitClueView("p-reja-mirillas", "p2");
    expect(viewA.visible).toEqual(["luna", null, "luna", null]);
    expect(viewB.visible).toEqual([null, "corona", null, "espada"]);
    const union = viewA.visible.map((fragment, index) => fragment ?? viewB.visible[index]!);
    const reja = session.submitSplitClue("p-reja-mirillas", union, clock.next(), "p2");
    expect(reja.outcome).toBe("correct");
    record(reja.engine);
    expect(session.objectState("reja-escalera")).toBe("open");

    for (const playerId of ["p1", "p2"]) {
      record(session.movePlayer(playerId, "catacumbas", 10, 17, clock.next()).engine);
    }
    expect(dialogs).toContain("d-catacumbas");

    playCatacumbas(script, "p2");

    const state = session.snapshot();
    expect(state.result).toBe("victory");
    expect(state.phase).toBe("ended");
    for (const puzzle of room.puzzles) {
      expect(state.puzzleStates[puzzle.id]?.state, `${puzzle.id} resuelto`).toBe("solved");
    }
    expect(state.puzzleStates["p-sello-final"]?.attempts).toBe(1);
    for (const ruleId of ONCE_RULES) {
      expect(
        fired.filter((id) => id === ruleId),
        `${ruleId} una vez`,
      ).toHaveLength(1);
    }
    expect(fired).not.toContain("r-tiempo-agotado");

    const summary = session.summary(clock.t);
    expect(summary?.result).toBe("victory");
    expect(summary?.stats.puzzlesSolved).toBe(room.puzzles.length);
    expect(3600 - (clock.t - state.startedAt) / 1000).toBeGreaterThan(0);

    // Tras la victoria, nada más cambia el mundo.
    expect(session.interact("trono", clock.next(), "p1").rejected).toBe("game_over");
  });
});

describe("integración — Rey Aldric en solitario (objetos-puente)", () => {
  it("un jugador gana con el busto en la placa y el espejo en la mirilla (ambos se gastan)", () => {
    const script = newScript(["p1"]);
    const { session, clock, record } = script;

    playSalonHastaArca(script);
    expect(session.inventory("p1")).toContain("busto-piedra");

    // 6. [Solo] busto de piedra en la placa izquierda + el jugador en la derecha
    record(session.movePlayer("p1", "salon-trono", PLACA_IZQ.x, PLACA_IZQ.y, clock.next()).engine);
    const bridge = session.useItemOnObject("busto-piedra", "placa-izq", clock.next(), "p1");
    expect(bridge.rejected).toBeUndefined();
    record(bridge.engine);
    // El puente se gasta al fijarse: desaparece del inventario, pero la placa
    // se queda hundida sola (fijada permanentemente, no por peso vivo).
    expect(session.inventory("p1")).not.toContain("busto-piedra");
    record(session.movePlayer("p1", "salon-trono", 10, 11, clock.next()).engine);
    expect(session.objectState("placa-izq")).toBe("down");
    expect(session.isPuzzleSolved("p-placas-estatuas")).toBe(false);
    record(session.movePlayer("p1", "salon-trono", PLACA_DER.x, PLACA_DER.y, clock.next()).engine);
    expect(session.isPuzzleSolved("p-placas-estatuas")).toBe(true);
    expect(session.objectState("puerta-bodega")).toBe("open");
    // El cáliz es un objeto distinto (2.11): sigue disponible para la ranura.
    expect(session.inventory("p1")).toContain("caliz-real");

    record(session.movePlayer("p1", "bodega", 9, 2, clock.next()).engine);
    playBodega(script, "p1", ["p1"]);

    // 11. [Solo] el espejo (escondido en el barril) revela la otra mitad
    record(session.interact("barril-espejo", clock.next(), "p1").engine);
    expect(session.inventory("p1")).toContain("espejo");
    record(session.movePlayer("p1", "bodega", MIRILLA_A.x, MIRILLA_A.y, clock.next()).engine);
    expect(session.splitClueView("p-reja-mirillas", "p1").visibleCount).toBe(2);
    record(session.useItemOnObject("espejo", "mirilla-a", clock.next(), "p1").engine);
    // El espejo también se gasta al fijarse en la mirilla.
    expect(session.inventory("p1")).not.toContain("espejo");
    const view = session.splitClueView("p-reja-mirillas", "p1");
    expect(view.bridged).toBe(true);
    expect(view.visible.every((fragment) => fragment !== null)).toBe(true);
    const reja = session.submitSplitClue(
      "p-reja-mirillas",
      view.visible as string[],
      clock.next(),
      "p1",
    );
    expect(reja.outcome).toBe("correct");
    record(reja.engine);

    record(session.movePlayer("p1", "catacumbas", 10, 17, clock.next()).engine);
    playCatacumbas(script, "p1");

    expect(session.state.result).toBe("victory");
  });
});

describe("integración — doble candado del sello (canal + altar)", () => {
  function reachCatacumbasWithoutGoldKey(): Script {
    const script = newScript(["p1", "p2"]);
    const { session, clock, record } = script;
    playSalonHastaArca(script);
    record(session.movePlayer("p1", "salon-trono", PLACA_IZQ.x, PLACA_IZQ.y, clock.next()).engine);
    record(session.movePlayer("p2", "salon-trono", PLACA_DER.x, PLACA_DER.y, clock.next()).engine);
    for (const playerId of ["p1", "p2"]) {
      record(session.movePlayer(playerId, "bodega", 9, 2, clock.next()).engine);
    }
    // Mural resuelto, pero nadie inspecciona la llave-plata: no hay llave-oro.
    solveMural(script, "p2");
    solveMemory(script, ["p1", "p2"]);
    record(session.movePlayer("p1", "bodega", MIRILLA_A.x, MIRILLA_A.y, clock.next()).engine);
    record(session.movePlayer("p2", "bodega", MIRILLA_B.x, MIRILLA_B.y, clock.next()).engine);
    record(
      session.submitSplitClue(
        "p-reja-mirillas",
        ["luna", "corona", "luna", "espada"],
        clock.next(),
        "p1",
      ).engine,
    );
    for (const playerId of ["p1", "p2"]) {
      record(session.movePlayer(playerId, "catacumbas", 10, 17, clock.next()).engine);
    }
    record(session.interact("vasijas", clock.next(), "p1").engine);
    return script;
  }

  it("sin llave-oro el canal no fluye y el sello 4538 no abre", () => {
    const script = reachCatacumbasWithoutGoldKey();
    const { session, clock } = script;
    expect(session.inventory("p2")).not.toContain("llave-oro");

    // La compuerta rechaza la llave que no se tiene; las piezas bien puestas no bastan.
    expect(
      session.openPipesGate("p-canal-agua", PIPES_GATE_INDEX, clock.next(), "p2").outcome,
    ).toBe("missing_item");
    rotateCanal(script, "p2");
    expect(session.isPuzzleSolved("p-canal-agua")).toBe(false);
    expect(session.pipesView("p-canal-agua").connected).toBe(false);
    expect(session.objectState("altar")).toBe("dry");

    // El sello está bloqueado (`requiresSolved: p-canal-agua`): el código correcto no abre.
    expect(session.puzzleState("p-sello-final")).toBe("locked");
    const sello = session.attemptCode("p-sello-final", "4538", clock.next(), "p1");
    expect(sello.outcome).toBe("unavailable");
    expect(session.isPuzzleSolved("p-sello-final")).toBe(false);
    expect(session.objectState("relicario")).toBe("sealed");
    session.tick(clock.t + 10_000);
    expect(session.state.result).toBeUndefined();
  });

  it("con la llave-oro (llave dentro de la llave) el mismo grupo desbloquea el sello", () => {
    const script = reachCatacumbasWithoutGoldKey();
    const { session, clock } = script;
    // La receta se juega desde cualquier sala: el inventario va con el jugador.
    expect(session.combine("p-combina", ["llave-plata"], clock.next(), "p2").result.outcome).toBe(
      "combined",
    );
    expect(session.objectState("compuerta-oro")).toBe("closed");
    playCatacumbas(script, "p2");
    expect(session.state.result).toBe("victory");
  });
});

describe("sesión — reglas del servidor autoritativo", () => {
  it("no se puede interactuar con objetos de otra habitación ni usar objetos que no se tienen", () => {
    const { session, clock } = newScript(["p1"]);
    expect(session.interact("vasijas", clock.next(), "p1").rejected).toBe("wrong_room");
    expect(session.useItemOnObject("llave-oro", "armario", clock.next(), "p1").rejected).toBe(
      "missing_item",
    );
    expect(session.flag("digito4")).toBeUndefined();
  });

  it("una placa no se pisa a distancia", () => {
    const { session, clock } = newScript(["p1"]);
    expect(
      session.setPlate("p-placas-estatuas", "placa-izq", true, clock.next(), "p1").outcome,
    ).toBe("unavailable");
    session.movePlayer("p1", "salon-trono", PLACA_IZQ.x, PLACA_IZQ.y, clock.next());
    expect(session.platesView("p-placas-estatuas").activeCount).toBe(1);
    session.movePlayer("p1", "salon-trono", 10, 11, clock.next());
    expect(session.platesView("p-placas-estatuas").activeCount).toBe(0);
    expect(session.objectState("placa-izq")).toBe("up");
  });

  it("las proyecciones públicas no contienen soluciones", () => {
    const { session } = newScript(["p1"]);
    const views = room.puzzles.map((puzzle) => JSON.stringify(session.puzzleView(puzzle.id, "p1")));
    const all = views.join("\n");
    expect(all).not.toContain("4732");
    expect(all).not.toContain("4538");
    expect(all).not.toContain("solution");
    expect(all).not.toContain("seed");
    expect(all).not.toContain("caliz-real");
    expect(all).not.toContain("espejo");
    // Fuera de las mirillas no se ve ningún fragmento.
    expect(session.splitClueView("p-reja-mirillas", "p1").visibleCount).toBe(0);
    // Ninguna carta de memoria muestra su símbolo antes de voltearse.
    expect(session.memoryView("p-copas-memoria").cards.every((card) => card.symbol === null)).toBe(
      true,
    );
  });
});
