import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import type { PipesPuzzleDefinition } from "@escaperoom/shared/schemas";
import { createPipesState, slidingNeighborIndices } from "@escaperoom/shared/templates";
import {
  ERROR_MESSAGE,
  GAME_MESSAGES,
  GAME_ROOM_NAME,
  GAME_TIME_LIMIT_SEC,
} from "../src/constants";
import { loadReyAldricRoomPackage } from "../src/game/room-packages";
import { GameRoom } from "../src/rooms/game-room";
import type { GameRoomState } from "../src/schema/game-state";
import { getFreePort } from "./helpers/free-port";
import { devTestGameToken } from "./helpers/game-token";

/**
 * E2E de protocolo del Rey Aldric (ticket 2.12, specs/22 §3.1 capa 1): dos
 * clientes de test de Colyseus, sin navegador, completan la ruta crítica de 14
 * pasos de `docs/reference/rey-aldric-notas-diseno.md` hablando **solo** el
 * protocolo real de la `GameRoom` (specs/11 §4–6) y moviéndose a las placas y
 * mirillas como haría un jugador.
 *
 * Vive en `colyseus-server` (y no en `game-runtime/__tests__`, que sugiere la
 * spec) porque aquí están el servidor y sus dependencias de test; así corre en
 * cada PR dentro de `pnpm turbo run test`.
 *
 * Sin esperas por tiempo fijo: cada paso espera la respuesta dirigida
 * (`attempt_result`, `puzzle_view`…) o un predicado sobre el estado
 * sincronizado, evaluado en cada parche. Lo único que se lee del lado servidor
 * es la contabilidad de reglas disparadas (`ruleRuns`), que el protocolo no
 * expone a propósito.
 */

const roomPackage = loadReyAldricRoomPackage();

const PLACA_IZQ = { x: 6, y: 11 };
const PLACA_DER = { x: 14, y: 11 };
const PUERTA_BODEGA = { x: 10, y: 12 };
const MIRILLA_A = { x: 9, y: 10 };
const MIRILLA_B = { x: 13, y: 10 };
const JUNTO_A_REJA = { x: 11, y: 10 };
const PIPES_GATE_INDEX = 2 * 5 + 3; // compuerta de oro en (3,2) de un 5×5

/** Reglas que la ruta crítica dispara exactamente una vez (notas de diseño, "Uso como fixture"). */
const ONCE_RULES = [
  "r-inicio",
  "r-inspeccionar-cuadro",
  "r-imagen-cuadro",
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
  "r-imagen-vasijas",
  "r-sello-resuelto",
] as const;

/** Códigos de los candados: ningún cliente debe recibirlos nunca. */
const LOCK_CODES = roomPackage.puzzles.flatMap((puzzle) =>
  puzzle.type === "code_lock" ? [puzzle.code] : [],
);
/** Claves que delatarían datos internos de una plantilla (soluciones, semillas, testigos). */
const FORBIDDEN_KEYS = new Set(["solution", "seed", "witness", "pairs", "code"]);

let colyseus: ColyseusTestServer;

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(GAME_ROOM_NAME, GameRoom);
  },
});

beforeAll(async () => {
  // Los dos clientes de este E2E son máquinas: encadenan intentos (el mural se
  // resuelve pieza a pieza) sin la cadencia de una persona. El rate limit por
  // mensaje (ticket 6.3, specs/11 §9) tiene su propio test en `message-rate-limit`.
  process.env.GAME_MESSAGE_RATE_LIMIT = "off";
  colyseus = await boot(config, await getFreePort());
});

afterAll(async () => {
  delete process.env.GAME_MESSAGE_RATE_LIMIT;
  await colyseus.shutdown();
});

type TestClient = Awaited<ReturnType<ColyseusTestServer["connectTo"]>> & {
  state: GameRoomState;
};

interface Received {
  type: string;
  payload: unknown;
}

/** Cliente de test + registro de todo lo que ha recibido (mensajes y estados). */
interface Player {
  name: string;
  client: TestClient;
  messages: Received[];
  states: unknown[];
}

interface Point {
  x: number;
  y: number;
}

async function joinPlayer(room: GameRoom, name: string): Promise<Player> {
  const client = (await colyseus.connectTo(room, { gameToken: devTestGameToken(), name })) as TestClient;
  const player: Player = { name, client, messages: [], states: [] };
  client.onMessage("*", (type, payload) => {
    player.messages.push({ type: String(type), payload });
  });
  client.onStateChange((state) => {
    player.states.push((state as GameRoomState).toJSON());
  });
  return player;
}

/** Resuelve cuando `predicate` se cumple sobre el estado sincronizado (se evalúa en cada parche). */
function until(player: Player, predicate: (state: GameRoomState) => boolean): Promise<void> {
  const { client } = player;
  if (predicate(client.state)) return Promise.resolve();
  return new Promise((resolve) => {
    const check = (): void => {
      if (!predicate(client.state)) return;
      client.onStateChange.remove(check);
      resolve();
    };
    client.onStateChange(check);
  });
}

/** Siguiente mensaje `type` que reciba el cliente (el listener se registra antes de enviar). */
function next<T = Record<string, unknown>>(player: Player, type: string): Promise<T> {
  return new Promise((resolve) => {
    const off = player.client.onMessage(type, (payload: unknown) => {
      off();
      resolve(payload as T);
    });
  });
}

/** Envía un comando y espera su respuesta dirigida; un `error` de protocolo rompe el test. */
async function request<T = Record<string, unknown>>(
  player: Player,
  type: string,
  payload: object,
  reply: string,
): Promise<T> {
  let offError: () => void = () => undefined;
  const failed = new Promise<never>((_, reject) => {
    offError = player.client.onMessage(ERROR_MESSAGE, (error: unknown) => {
      reject(
        new Error(
          `${player.name}: ${type} ${JSON.stringify(payload)} rechazado → ${JSON.stringify(error)}`,
        ),
      );
    });
  });
  const answer = next<T>(player, reply);
  player.client.send(type, payload);
  try {
    return await Promise.race([answer, failed]);
  } finally {
    offError();
  }
}

type AttemptResult = {
  puzzleId: string;
  ok: boolean;
  outcome: string;
  revealedSymbol?: string;
};

function attempt(player: Player, puzzleId: string, value: object): Promise<AttemptResult> {
  return request<AttemptResult>(
    player,
    GAME_MESSAGES.puzzleAttempt,
    { puzzleId, attempt: value },
    GAME_MESSAGES.attemptResult,
  );
}

/** Abre el panel, lee la vista pública y lo cierra (así no llegan reenvíos a destiempo). */
async function viewPuzzle<T>(player: Player, puzzleId: string): Promise<T> {
  const { view } = await request<{ view: T }>(
    player,
    GAME_MESSAGES.puzzleOpen,
    { puzzleId },
    GAME_MESSAGES.puzzleView,
  );
  player.client.send(GAME_MESSAGES.puzzleClose, { puzzleId });
  return view;
}

function me(player: Player) {
  return player.client.state.players.get(player.client.sessionId)!;
}

function inventory(player: Player): string[] {
  return [...(player.client.state.inventories.get(player.client.sessionId)?.items ?? [])];
}

function hasItems(player: Player, items: string[]): Promise<void> {
  return until(player, () => items.every((item) => inventory(player).includes(item)));
}

function puzzleSolved(player: Player, puzzleId: string): Promise<void> {
  return until(player, (state) => state.puzzles.get(puzzleId)?.state === "solved");
}

/** Camina en pasos de ≤ 2,5 celdas (por debajo del salto máximo) hasta `to`. */
async function walk(player: Player, to: Point): Promise<void> {
  const from = { x: me(player).x, y: me(player).y };
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2.5));
  for (let step = 1; step <= steps; step += 1) {
    player.client.send(GAME_MESSAGES.move, {
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    });
  }
  await until(player, () => Math.hypot(me(player).x - to.x, me(player).y - to.y) < 0.01);
}

/** Cruza a otra habitación (hay que estar junto a la puerta abierta). */
async function enterRoom(player: Player, roomId: string): Promise<void> {
  player.client.send(GAME_MESSAGES.move, { x: 0, y: 0, roomId });
  await until(player, () => me(player).roomId === roomId);
}

/** Tablero del mural codificado en base 10 (≤ 9 celdas: cabe en un `number`). */
function encode(board: readonly number[]): number {
  return board.reduce((key, tile) => key * 10 + tile, 0);
}

/** BFS sobre la vista pública del mural: índices a deslizar hasta el tablero ordenado. */
function solveSliding(tiles: number[], cols: number, rows: number): number[] {
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
      const candidate = board.slice();
      candidate[blank] = candidate[index]!;
      candidate[index] = 0;
      const candidateKey = encode(candidate);
      if (previous.has(candidateKey)) continue;
      previous.set(candidateKey, { from: key, move: index });
      boards.set(candidateKey, candidate);
      queue.push(candidateKey);
    }
  }
  const moves: number[] = [];
  for (let step = previous.get(goal); step; step = previous.get(step.from)) {
    moves.unshift(step.move);
  }
  return moves;
}

/** Paso 7: el mural pieza a pieza (`attempt: { move }`), a partir de la vista pública. */
async function solveMural(player: Player): Promise<void> {
  const view = await viewPuzzle<{ tiles: number[]; grid: { cols: number; rows: number } }>(
    player,
    "p-mural-vendimia",
  );
  const moves = solveSliding(view.tiles, view.grid.cols, view.grid.rows);
  expect(moves.length).toBeGreaterThan(0);
  for (const move of moves) {
    const result = await attempt(player, "p-mural-vendimia", { move });
    expect(["moved", "solved"]).toContain(result.outcome);
  }
}

/**
 * Paso 10: el `memory` jugado como un grupo real. Solo se conocen los símbolos
 * que el servidor revela al voltear (`revealedSymbol`); los jugadores se turnan.
 */
async function solveMemory(players: Player[]): Promise<void> {
  const view = await viewPuzzle<{ cards: { id: string; symbol: string | null }[] }>(
    players[0]!,
    "p-copas-memoria",
  );
  expect(view.cards.every((card) => card.symbol === null)).toBe(true);
  const known = new Map<string, string>();
  const matched = new Set<string>();
  let turn = 0;

  const flip = async (cardId: string): Promise<AttemptResult> => {
    const player = players[turn % players.length]!;
    const result = await attempt(player, "p-copas-memoria", { flip: cardId });
    expect(result.ok).toBe(true);
    expect(result.revealedSymbol).toBeTruthy();
    known.set(cardId, result.revealedSymbol!);
    return result;
  };

  for (let guard = 0; guard < 20 && matched.size < view.cards.length; guard += 1) {
    const hidden = view.cards.map((card) => card.id).filter((id) => !matched.has(id));
    // Si ya se conoce una pareja, se voltea; si no, una carta nueva y su
    // compañera si ya se vio (o bien otra carta nueva).
    const knownPair = hidden
      .flatMap((a) =>
        hidden
          .filter((b) => b !== a && known.has(a) && known.get(a) === known.get(b))
          .map((b) => [a, b] as const),
      )
      .at(0);
    const first = knownPair?.[0] ?? hidden.find((id) => !known.has(id))!;
    const firstResult = await flip(first);
    const second =
      knownPair?.[1] ??
      hidden.find((id) => id !== first && known.get(id) === firstResult.revealedSymbol) ??
      hidden.find((id) => id !== first && !known.has(id))!;
    const secondResult = await flip(second);
    expect(["match", "mismatch"]).toContain(secondResult.outcome);
    if (secondResult.outcome === "match") {
      matched.add(first);
      matched.add(second);
    }
    turn += 1;
  }
  expect(matched.size).toBe(view.cards.length);
}

/** Paso 12: compuerta de oro + piezas orientadas hacia el testigo, una a una. */
async function solveCanal(player: Player): Promise<void> {
  const gate = await attempt(player, "p-canal-agua", { gate: PIPES_GATE_INDEX });
  expect(["opened", "solved"]).toContain(gate.outcome);
  if (gate.outcome === "solved") return;

  // El jugador "prueba" hasta que el agua llega; el test usa el testigo
  // determinista de la plantilla para no depender de una búsqueda.
  const def = roomPackage.puzzles.find(
    (puzzle) => puzzle.id === "p-canal-agua",
  ) as PipesPuzzleDefinition;
  const witness = createPipesState(def).solution;
  const view = await viewPuzzle<{
    cells: { index: number; rotation: number; rotatable: boolean }[];
  }>(player, "p-canal-agua");
  for (const cell of view.cells) {
    if (!cell.rotatable) continue;
    const turns = (((witness[cell.index]! - cell.rotation) % 4) + 4) % 4;
    if (turns === 0) continue;
    const rotated = await attempt(player, "p-canal-agua", { rotate: cell.index, turns });
    expect(["rotated", "solved"]).toContain(rotated.outcome);
    if (rotated.outcome === "solved") return;
  }
  throw new Error("El agua no llegó al altar tras orientar todas las piezas.");
}

/**
 * Busca en todo lo recibido (mensajes y estados) cualquier cosa que resuelva
 * un puzzle: claves de datos internos, códigos de candado o símbolos de
 * cartas boca abajo. Devuelve la lista de fugas encontradas.
 */
function findLeaks(player: Player): string[] {
  const leaks: string[] = [];
  const scan = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      if (LOCK_CODES.includes(value)) leaks.push(`${path} = "${value}"`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => scan(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        // `error.code` es el código de error de protocolo, no un candado.
        if (FORBIDDEN_KEYS.has(key) && !(key === "code" && path.endsWith(ERROR_MESSAGE))) {
          leaks.push(`${path}.${key}`);
        }
        scan(child, `${path}.${key}`);
      }
    }
  };
  player.messages.forEach((message, index) => {
    scan(message.payload, `${player.name}.messages[${index}].${message.type}`);
    // Memory: una carta boca abajo nunca viaja con su símbolo.
    const view = (message.payload as { view?: { type?: string; cards?: unknown[] } } | undefined)
      ?.view;
    if (message.type === GAME_MESSAGES.puzzleView && view?.type === "memory") {
      for (const card of view.cards as { flipped: boolean; symbol: string | null }[]) {
        if (!card.flipped && card.symbol !== null) {
          leaks.push(`${player.name}.messages[${index}]: símbolo de carta boca abajo`);
        }
      }
    }
  });
  player.states.forEach((state, index) => scan(state, `${player.name}.states[${index}]`));
  return leaks;
}

describe("E2E de protocolo — Rey Aldric con 2 clientes de Colyseus", () => {
  it("la ruta crítica de 14 pasos termina en victoria sin filtrar soluciones", async () => {
    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, { gameToken: devTestGameToken() });
    const a = await joinPlayer(room, "Ana");
    const b = await joinPlayer(room, "Bruno");

    a.client.send(GAME_MESSAGES.setReady, { ready: true });
    b.client.send(GAME_MESSAGES.setReady, { ready: true });
    await expect.poll(() => room.state.players.get(b.client.sessionId)?.ready).toBe(true);
    const intro = next(b, GAME_MESSAGES.dialogShow);
    a.client.send(GAME_MESSAGES.startGame, {});
    expect(await intro).toEqual({ dialogId: "d-intro" });
    await until(b, (state) => state.phase === "playing");

    // — Salón del Trono (pasos 1–6) ——————————————————————————————————
    // 1. Inspeccionar el cuadro → llave-bronce
    a.client.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    await hasItems(a, ["llave-bronce"]);
    // 2. Abrir el armario con la llave → yesquero + vela
    a.client.send(GAME_MESSAGES.useItem, { itemId: "llave-bronce", objectId: "armario" });
    await hasItems(a, ["yesquero", "vela"]);
    // 3. Combinar yesquero + vela → antorcha
    const torch = await request<AttemptResult & { output?: string }>(
      a,
      GAME_MESSAGES.combine,
      { puzzleId: "p-combina", inputs: ["yesquero", "vela"] },
      GAME_MESSAGES.attemptResult,
    );
    expect(torch).toMatchObject({ ok: true, output: "antorcha" });
    await hasItems(a, ["antorcha"]);
    // 4. Encender el brasero → dígito 3 visible
    a.client.send(GAME_MESSAGES.interact, { objectId: "brasero" });
    await until(a, (state) => state.flags.get("digito3") === "3");
    // 5. Candado del arca "4732" → cáliz + pergamino
    expect(await attempt(a, "p-candado-arca", { code: "4732" })).toMatchObject({
      ok: true,
      outcome: "correct",
    });
    await hasItems(a, ["caliz-real", "pergamino-bodega"]);
    // 6. Placas simultáneas: un jugador en cada una → puerta a la Bodega
    const opened = next<{ puzzleId: string; unlocks: string[] }>(b, GAME_MESSAGES.puzzleSolved);
    await walk(a, PLACA_IZQ);
    await walk(b, PLACA_DER);
    expect(await opened).toMatchObject({
      puzzleId: "p-placas-estatuas",
      unlocks: ["puerta-bodega"],
    });
    await until(a, (state) => state.objects.get("puerta-bodega") === "open");

    for (const player of [a, b]) {
      await walk(player, PUERTA_BODEGA);
      await enterRoom(player, "bodega");
    }

    // — Bodega (pasos 7–11) ——————————————————————————————————————————
    // 7. Mural 3×3 (seed 812) → compartimento → llave-plata
    await solveMural(b);
    await puzzleSolved(b, "p-mural-vendimia");
    await hasItems(b, ["llave-plata"]);
    await until(b, (state) => state.objects.get("compartimento-plata") === "open");
    // 8. Inspeccionar la llave-plata → llave-oro (sin consumirla)
    const goldKey = await request<AttemptResult & { output?: string }>(
      b,
      GAME_MESSAGES.combine,
      { puzzleId: "p-combina", inputs: ["llave-plata"] },
      GAME_MESSAGES.attemptResult,
    );
    expect(goldKey).toMatchObject({ ok: true, outcome: "combined", output: "llave-oro" });
    await hasItems(b, ["llave-plata", "llave-oro"]);
    // 9. Cáliz en la ranura del mural (lore) y recuperarlo (r-recoger-caliz)
    const ranura = next(a, GAME_MESSAGES.dialogShow);
    a.client.send(GAME_MESSAGES.interact, { objectId: "mural-ranura" });
    expect(await ranura).toEqual({ dialogId: "d-ranura" });
    await hasItems(a, ["caliz-real"]);
    // 10. Copas de memoria (3 pares) → dígito 3 + antorchas de la escalera
    await solveMemory([a, b]);
    await puzzleSolved(a, "p-copas-memoria");
    await until(a, (state) => state.objects.get("mesa-catas") === "active");
    // 11. Mirillas: cada jugador ve solo su mitad; juntos abren la reja
    await walk(a, MIRILLA_A);
    await walk(b, MIRILLA_B);
    type Fragments = { viewpointId: string | null; fragments: Record<string, string> };
    const halfA = await request<Fragments>(
      a,
      GAME_MESSAGES.splitView,
      {},
      GAME_MESSAGES.splitFragments,
    );
    const halfB = await request<Fragments>(
      b,
      GAME_MESSAGES.splitView,
      {},
      GAME_MESSAGES.splitFragments,
    );
    expect(halfA.viewpointId).toBe("mirilla-a");
    expect(halfB.viewpointId).toBe("mirilla-b");
    // Ninguna mitad basta por sí sola.
    expect(Object.keys(halfA.fragments).length).toBeLessThan(4);
    expect(Object.keys(halfB.fragments).length).toBeLessThan(4);
    const symbols = [0, 1, 2, 3].map((index) => halfA.fragments[index] ?? halfB.fragments[index]!);
    expect(await attempt(b, "p-reja-mirillas", { symbols })).toMatchObject({
      ok: true,
      outcome: "correct",
    });
    await until(b, (state) => state.objects.get("reja-escalera") === "open");

    const catacumbas = next(a, GAME_MESSAGES.dialogShow);
    await walk(a, JUNTO_A_REJA);
    await enterRoom(a, "catacumbas");
    expect(await catacumbas).toEqual({ dialogId: "d-catacumbas" });
    await enterRoom(b, "catacumbas");

    // — Catacumbas (pasos 12–14) ———————————————————————————————————————
    // 12. Canal de tuberías: la compuerta de oro se abre con la llave-oro
    await solveCanal(b);
    await puzzleSolved(b, "p-canal-agua");
    await until(b, (state) => state.objects.get("altar") === "flowing");
    // 13. Vasijas (dígito 8) y sarcófago (recuerdo del código)
    a.client.send(GAME_MESSAGES.interact, { objectId: "vasijas" });
    a.client.send(GAME_MESSAGES.interact, { objectId: "sarcofago" });
    await until(a, (state) => state.flags.get("digito4") === "8");
    // 14. Sello final "4538" → relicario → VICTORIA (tras el `delay` de 4 s)
    const endedA = next<{ result: string; stats: { durationSec: number } | null }>(
      a,
      GAME_MESSAGES.gameEnded,
    );
    const endedB = next<{ result: string }>(b, GAME_MESSAGES.gameEnded);
    expect(await attempt(a, "p-sello-final", { code: "4538" })).toMatchObject({
      ok: true,
      outcome: "correct",
    });
    await until(a, (state) => state.objects.get("relicario") === "open");
    const [end] = await Promise.all([endedA, endedB]);

    // — Asserts de la notas de diseño ("Uso como fixture") ————————————————
    expect(end.result).toBe("victory");
    expect((await endedB).result).toBe("victory");
    await until(b, (state) => state.phase === "ended");
    expect(b.client.state.result).toBe("victory");

    for (const puzzle of roomPackage.puzzles) {
      expect(b.client.state.puzzles.get(puzzle.id)?.state, `${puzzle.id} resuelto`).toBe("solved");
    }
    expect(b.client.state.puzzles.get("p-sello-final")?.attempts).toBe(1);

    // timeRemaining > 0: el reloj de la partida no llegó a `endsAt`.
    const state = b.client.state;
    expect(state.endsAt - state.clock).toBeGreaterThan(0);
    expect(end.stats?.durationSec).toBeLessThan(GAME_TIME_LIMIT_SEC);
    expect(Number(room["session"]!.flag("time_remaining"))).toBeGreaterThan(0);

    // Reglas disparadas: contabilidad del motor en el servidor (no viaja por protocolo).
    const ruleRuns = room["session"]!.snapshot().ruleRuns;
    for (const ruleId of ONCE_RULES) {
      expect(ruleRuns[ruleId]?.count ?? 0, `${ruleId} una vez`).toBe(1);
    }
    expect(ruleRuns["r-recoger-caliz"]?.count ?? 0).toBeGreaterThanOrEqual(1);
    expect(ruleRuns["r-tiempo-agotado"]).toBeUndefined();
    const unexpected = Object.keys(ruleRuns).filter(
      (ruleId) =>
        !(ONCE_RULES as readonly string[]).includes(ruleId) && ruleId !== "r-recoger-caliz",
    );
    expect(unexpected).toEqual([]);

    // Ningún cliente recibió nunca una solución.
    for (const player of [a, b]) {
      expect(player.messages.length).toBeGreaterThan(0);
      expect(player.states.length).toBeGreaterThan(0);
      expect(findLeaks(player)).toEqual([]);
    }

    await a.client.leave();
    await b.client.leave();
  }, 30_000);

  it("el detector de fugas no es un falso verde: encuentra soluciones plantadas", () => {
    const planted: Player = {
      name: "Espía",
      client: undefined as unknown as TestClient,
      messages: [
        { type: GAME_MESSAGES.attemptResult, payload: { ok: false, outcome: "wrong" } },
        { type: ERROR_MESSAGE, payload: { code: "NOT_AVAILABLE", message: "…" } },
        { type: GAME_MESSAGES.puzzleView, payload: { view: { solution: [0, 1] } } },
        {
          type: GAME_MESSAGES.puzzleView,
          payload: { view: { type: "memory", cards: [{ flipped: false, symbol: "uva" }] } },
        },
      ],
      states: [{ flags: { pista: "4538" } }, { puzzles: { p: { seed: 812 } } }],
    };
    expect(findLeaks(planted)).toEqual([
      "Espía.messages[2].puzzle_view.view.solution",
      "Espía.messages[3]: símbolo de carta boca abajo",
      'Espía.states[0].flags.pista = "4538"',
      "Espía.states[1].puzzles.p.seed",
    ]);
  });
});
