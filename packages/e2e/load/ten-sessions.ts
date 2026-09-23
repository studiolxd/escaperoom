import { performance } from "node:perf_hooks";
import { createServer } from "node:net";
import { Client, type Room } from "@colyseus/sdk";
import {
  ERROR_MESSAGE,
  GAME_MESSAGES,
  GAME_ROOM_NAME,
  loadReyAldricRoomPackage,
  startGameServer,
} from "@escaperoom/colyseus-server";
import type { PipesPuzzleDefinition } from "@escaperoom/shared/schemas";
import { createPipesState, slidingNeighborIndices } from "@escaperoom/shared/templates";

/**
 * Prueba de carga de 10 sesiones simultáneas (plan fase 6, fila 6.5; specs/22
 * §3). Clientes de **protocolo** (`@colyseus/sdk`, sin navegador): cada sesión
 * son 2 jugadores que recorren la ruta crítica completa del Rey Aldric (14
 * pasos) hasta `game_ended {result: "victory"}`, a ritmo de persona para caber
 * en los límites por mensaje de la `GameRoom` (specs/11 §9), que siguen
 * encendidos.
 *
 * Primero una sesión sola (referencia) y luego `LOAD_SESSIONS` a la vez; se
 * compara la latencia de ida y vuelta de cada comando (`attempt_result`,
 * `puzzle_view`…). «Sin degradación»: todas las sesiones ganan y el p95 bajo
 * carga no pasa de `max(3 × p95 de referencia, 150 ms)`.
 *
 *   pnpm --filter @escaperoom/e2e load                     # servidor en proceso
 *   E2E_LOAD_URL=ws://localhost:2667 pnpm --filter @escaperoom/e2e load
 *
 * Sale con código 1 si alguna sesión falla o hay degradación.
 */

const SESSIONS = Number(process.env.LOAD_SESSIONS ?? 10);
/** 2 `puzzle_attempt`/s por puzzle y 10 `move`/s por cliente (specs/11 §9). */
const ATTEMPT_SPACING_MS = 550;
const MOVE_SPACING_MS = 120;
const SESSION_TIMEOUT_MS = 180_000;

const roomPackage = loadReyAldricRoomPackage();
const PLACA_IZQ = { x: 6, y: 11 };
const PLACA_DER = { x: 14, y: 11 };
const PUERTA_BODEGA = { x: 10, y: 12 };
const MIRILLA_A = { x: 9, y: 10 };
const MIRILLA_B = { x: 13, y: 10 };
const JUNTO_A_REJA = { x: 11, y: 10 };
const PIPES_GATE_INDEX = 2 * 5 + 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface RateLimited {
  code: string;
  retryAfterMs?: number;
}

interface Point {
  x: number;
  y: number;
}

/** Estado sincronizado de la `GameRoom` tal como lo decodifica el SDK (sin tipos de schema). */
interface SyncedState {
  phase: string;
  result: string;
  players: { get(id: string): { x: number; y: number; roomId: string } | undefined };
  inventories: { get(id: string): { items: Iterable<string> } | undefined };
  puzzles: { get(id: string): { state: string } | undefined };
  objects: { get(id: string): string | undefined };
  flags: { get(id: string): string | undefined };
}

/** Latencias de ida y vuelta (ms) de todos los comandos con respuesta dirigida. */
class Metrics {
  readonly rtts: number[] = [];
  /** Comandos que el servidor frenó con `RATE_LIMITED` y se reintentaron tras `retryAfterMs`. */
  rateLimited = 0;

  percentile(p: number): number {
    if (this.rtts.length === 0) return 0;
    const sorted = [...this.rtts].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
  }
}

class ProtocolPlayer {
  private lastAttempt = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly room: Room,
    private readonly metrics: Metrics,
  ) {}

  get state(): SyncedState {
    return this.room.state as unknown as SyncedState;
  }

  me() {
    return this.state.players.get(this.room.sessionId)!;
  }

  inventory(): string[] {
    return [...(this.state.inventories.get(this.room.sessionId)?.items ?? [])];
  }

  /** Resuelve cuando `predicate` se cumple sobre el estado (se evalúa en cada parche). */
  until(predicate: (state: SyncedState) => boolean, what: string): Promise<void> {
    if (predicate(this.state)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const check = (): void => {
        if (!predicate(this.state)) return;
        clearTimeout(timer);
        this.room.onStateChange.remove(check);
        resolve();
      };
      const timer = setTimeout(() => {
        this.room.onStateChange.remove(check);
        reject(new Error(`${this.name}: sin «${what}» en 30 s`));
      }, 30_000);
      this.room.onStateChange(check);
    });
  }

  next<T = Record<string, unknown>>(type: string): Promise<T> {
    return new Promise((resolve) => {
      const off = this.room.onMessage(type, (payload: unknown) => {
        off();
        resolve(payload as T);
      });
    });
  }

  /**
   * Comando con respuesta dirigida; mide la latencia. Un `RATE_LIMITED` se
   * reintenta tras `retryAfterMs` (como haría un cliente bien educado) y se
   * cuenta; cualquier otro `error` de protocolo rompe la sesión.
   */
  async request<T = Record<string, unknown>>(
    type: string,
    payload: object,
    reply: string,
  ): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let offError: () => void = () => undefined;
      let offAnswer: () => void = () => undefined;
      const outcome = new Promise<{ ok: true; value: T } | { ok: false; error: RateLimited }>(
        (resolve, reject) => {
          offAnswer = this.room.onMessage(reply, (value: unknown) =>
            resolve({ ok: true, value: value as T }),
          );
          offError = this.room.onMessage(ERROR_MESSAGE, (error: RateLimited) => {
            if (error?.code === "RATE_LIMITED") resolve({ ok: false, error });
            else reject(new Error(`${this.name}: ${type} rechazado → ${JSON.stringify(error)}`));
          });
        },
      );
      const started = performance.now();
      this.room.send(type, payload);
      try {
        const result = await outcome;
        if (result.ok) {
          this.metrics.rtts.push(performance.now() - started);
          return result.value;
        }
        this.metrics.rateLimited += 1;
        await sleep((result.error.retryAfterMs ?? 100) + 20);
      } finally {
        offError();
        offAnswer();
      }
    }
    throw new Error(`${this.name}: ${type} frenado 5 veces seguidas por RATE_LIMITED`);
  }

  /** `puzzle_attempt` a ritmo de persona (≤ 2/s por puzzle). */
  async attempt(
    puzzleId: string,
    value: object,
  ): Promise<{ ok: boolean; outcome: string; revealedSymbol?: string }> {
    const wait = (this.lastAttempt.get(puzzleId) ?? 0) + ATTEMPT_SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastAttempt.set(puzzleId, Date.now());
    return this.request(
      GAME_MESSAGES.puzzleAttempt,
      { puzzleId, attempt: value },
      GAME_MESSAGES.attemptResult,
    );
  }

  async view<T>(puzzleId: string): Promise<T> {
    const { view } = await this.request<{ view: T }>(
      GAME_MESSAGES.puzzleOpen,
      { puzzleId },
      GAME_MESSAGES.puzzleView,
    );
    this.room.send(GAME_MESSAGES.puzzleClose, { puzzleId });
    return view;
  }

  hasItems(items: string[]): Promise<void> {
    return this.until(
      () => items.every((item) => this.inventory().includes(item)),
      items.join("+"),
    );
  }

  /** Camina en pasos de ≤ 2,5 celdas, ≤ 10 `move`/s. */
  async walk(to: Point): Promise<void> {
    const from = { x: this.me().x, y: this.me().y };
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2.5));
    for (let step = 1; step <= steps; step += 1) {
      this.room.send(GAME_MESSAGES.move, {
        x: from.x + ((to.x - from.x) * step) / steps,
        y: from.y + ((to.y - from.y) * step) / steps,
      });
      await sleep(MOVE_SPACING_MS);
    }
    await this.until(() => Math.hypot(this.me().x - to.x, this.me().y - to.y) < 0.01, "llegar");
  }

  async enterRoom(roomId: string): Promise<void> {
    this.room.send(GAME_MESSAGES.move, { x: 0, y: 0, roomId });
    await this.until(() => this.me().roomId === roomId, `entrar en ${roomId}`);
    await sleep(MOVE_SPACING_MS);
  }
}

function encode(board: readonly number[]): number {
  return board.reduce((key, tile) => key * 10 + tile, 0);
}

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
  for (let step = previous.get(goal); step; step = previous.get(step.from))
    moves.unshift(step.move);
  return moves;
}

/** Una sesión completa: 2 jugadores, 14 pasos, victoria. Devuelve la duración en ms. */
async function playSession(endpoint: string, index: number, metrics: Metrics): Promise<number> {
  const started = performance.now();
  const sdk = new Client(endpoint);
  const hostRoom = await sdk.create(GAME_ROOM_NAME, {
    name: `Ana-${index}`,
    packageId: "room-rey-aldric",
  });
  const guestRoom = await new Client(endpoint).joinById(hostRoom.roomId, {
    name: `Bruno-${index}`,
  });
  // El resto de difusiones (diálogos, objetos, puzzles resueltos) no hacen falta aquí.
  for (const room of [hostRoom, guestRoom]) room.onMessage("*", () => undefined);
  const a = new ProtocolPlayer(`sesión ${index}/Ana`, hostRoom, metrics);
  const b = new ProtocolPlayer(`sesión ${index}/Bruno`, guestRoom, metrics);
  try {
    a.room.send(GAME_MESSAGES.startGame, {});
    await b.until((state) => state.phase === "playing", "playing");

    // Salón del Trono (1–6)
    a.room.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    await a.hasItems(["llave-bronce"]);
    a.room.send(GAME_MESSAGES.useItem, { itemId: "llave-bronce", objectId: "armario" });
    await a.hasItems(["mechero", "vela"]);
    await a.request(
      GAME_MESSAGES.combine,
      { puzzleId: "p-combina", inputs: ["mechero", "vela"] },
      GAME_MESSAGES.attemptResult,
    );
    a.room.send(GAME_MESSAGES.interact, { objectId: "brasero" });
    await a.until((state) => state.flags.get("digito3") === "3", "dígito 3");
    await a.attempt("p-candado-arca", { code: "4732" });
    await a.hasItems(["caliz-real", "pergamino-bodega"]);
    await Promise.all([a.walk(PLACA_IZQ), b.walk(PLACA_DER)]);
    await a.until((state) => state.objects.get("puerta-bodega") === "open", "puerta bodega");
    for (const player of [a, b]) {
      await player.walk(PUERTA_BODEGA);
      await player.enterRoom("bodega");
    }

    // Bodega (7–11)
    const mural = await b.view<{ tiles: number[]; grid: { cols: number; rows: number } }>(
      "p-mural-vendimia",
    );
    for (const move of solveSliding(mural.tiles, mural.grid.cols, mural.grid.rows)) {
      await b.attempt("p-mural-vendimia", { move });
    }
    await b.hasItems(["llave-plata"]);
    await b.request(
      GAME_MESSAGES.combine,
      { puzzleId: "p-combina", inputs: ["llave-plata"] },
      GAME_MESSAGES.attemptResult,
    );
    await b.hasItems(["llave-oro"]);
    a.room.send(GAME_MESSAGES.interact, { objectId: "mural-ranura" });
    await sleep(ATTEMPT_SPACING_MS);

    const memory = await a.view<{ cards: { id: string }[] }>("p-copas-memoria");
    const known = new Map<string, string>();
    const matched = new Set<string>();
    for (let turn = 0; turn < 20 && matched.size < memory.cards.length; turn += 1) {
      const player = turn % 2 === 0 ? a : b;
      const hidden = memory.cards.map((card) => card.id).filter((id) => !matched.has(id));
      const pair = hidden
        .flatMap((x) =>
          hidden
            .filter((y) => y !== x && known.has(x) && known.get(x) === known.get(y))
            .map((y) => [x, y] as const),
        )
        .at(0);
      const first = pair?.[0] ?? hidden.find((id) => !known.has(id))!;
      const r1 = await player.attempt("p-copas-memoria", { flip: first });
      known.set(first, r1.revealedSymbol!);
      const second =
        pair?.[1] ??
        hidden.find((id) => id !== first && known.get(id) === r1.revealedSymbol) ??
        hidden.find((id) => id !== first && !known.has(id))!;
      const r2 = await player.attempt("p-copas-memoria", { flip: second });
      known.set(second, r2.revealedSymbol!);
      if (r2.outcome === "match") {
        matched.add(first);
        matched.add(second);
      }
    }
    await a.until((state) => state.puzzles.get("p-copas-memoria")?.state === "solved", "memoria");

    await Promise.all([a.walk(MIRILLA_A), b.walk(MIRILLA_B)]);
    type Fragments = { fragments: Record<string, string> };
    const halfA = await a.request<Fragments>(
      GAME_MESSAGES.splitView,
      {},
      GAME_MESSAGES.splitFragments,
    );
    const halfB = await b.request<Fragments>(
      GAME_MESSAGES.splitView,
      {},
      GAME_MESSAGES.splitFragments,
    );
    const symbols = [0, 1, 2, 3].map((i) => halfA.fragments[i] ?? halfB.fragments[i]!);
    await b.attempt("p-reja-mirillas", { symbols });
    await b.until((state) => state.objects.get("reja-escalera") === "open", "reja");
    for (const player of [a, b]) {
      await player.walk(JUNTO_A_REJA);
      await player.enterRoom("catacumbas");
    }

    // Catacumbas (12–14)
    await b.attempt("p-canal-agua", { gate: PIPES_GATE_INDEX });
    const def = roomPackage.puzzles.find((p) => p.id === "p-canal-agua") as PipesPuzzleDefinition;
    const witness = createPipesState(def).solution;
    const pipes = await b.view<{
      cells: { index: number; rotation: number; rotatable: boolean }[];
    }>("p-canal-agua");
    for (const cell of pipes.cells) {
      if (!cell.rotatable) continue;
      const turns = (((witness[cell.index]! - cell.rotation) % 4) + 4) % 4;
      if (turns === 0) continue;
      const rotated = await b.attempt("p-canal-agua", { rotate: cell.index, turns });
      if (rotated.outcome === "solved") break;
    }
    await b.until((state) => state.objects.get("altar") === "flowing", "altar");
    a.room.send(GAME_MESSAGES.interact, { objectId: "vasijas" });
    await sleep(300);
    a.room.send(GAME_MESSAGES.interact, { objectId: "sarcofago" });
    await a.until((state) => state.flags.get("digito4") === "8", "dígito 8");
    const ended = Promise.all([
      a.next<{ result: string }>(GAME_MESSAGES.gameEnded),
      b.next<{ result: string }>(GAME_MESSAGES.gameEnded),
    ]);
    await a.attempt("p-sello-final", { code: "4538" });
    const results = await ended;
    if (results.some((end) => end.result !== "victory")) {
      throw new Error(`sesión ${index}: resultado ${results.map((r) => r.result).join("/")}`);
    }
    return performance.now() - started;
  } finally {
    await Promise.allSettled([a.room.leave(), b.room.leave()]);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label}: timeout`)), ms)),
  ]);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("sin puerto")),
      );
    });
  });
}

async function runBatch(endpoint: string, count: number, offset: number) {
  const metrics = new Metrics();
  const started = performance.now();
  const outcomes = await Promise.allSettled(
    Array.from({ length: count }, (_, i) =>
      withTimeout(
        playSession(endpoint, offset + i, metrics),
        SESSION_TIMEOUT_MS,
        `sesión ${offset + i}`,
      ),
    ),
  );
  const durations = outcomes.flatMap((o) => (o.status === "fulfilled" ? [o.value] : []));
  const failures = outcomes.flatMap((o) => (o.status === "rejected" ? [String(o.reason)] : []));
  return { metrics, durations, failures, wallMs: performance.now() - started };
}

const fmt = (ms: number) => `${ms.toFixed(1)} ms`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

async function main(): Promise<void> {
  let endpoint = process.env.E2E_LOAD_URL;
  let server: Awaited<ReturnType<typeof startGameServer>> | undefined;
  if (!endpoint) {
    const port = await freePort();
    server = await startGameServer(port);
    endpoint = `ws://localhost:${port}`;
  }
  console.log(`▶ Carga contra ${endpoint}${server ? " (servidor en proceso)" : ""}`);
  const rss = () => `${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MB`;

  const baseline = await runBatch(endpoint, 1, 0);
  if (baseline.failures.length > 0)
    throw new Error(`La sesión de referencia falló: ${baseline.failures[0]}`);
  const load = await runBatch(endpoint, SESSIONS, 1);

  const p95Base = baseline.metrics.percentile(95);
  const p95Load = load.metrics.percentile(95);
  const budget = Math.max(3 * p95Base, 150);
  console.log("\nResultados");
  console.table({
    referencia: {
      sesiones: `${baseline.durations.length}/1`,
      comandos: baseline.metrics.rtts.length,
      "frenados (429)": baseline.metrics.rateLimited,
      p50: fmt(baseline.metrics.percentile(50)),
      p95: fmt(p95Base),
      max: fmt(baseline.metrics.percentile(100)),
      "duración media": secs(baseline.durations[0] ?? 0),
    },
    [`${SESSIONS} simultáneas`]: {
      sesiones: `${load.durations.length}/${SESSIONS}`,
      comandos: load.metrics.rtts.length,
      "frenados (429)": load.metrics.rateLimited,
      p50: fmt(load.metrics.percentile(50)),
      p95: fmt(p95Load),
      max: fmt(load.metrics.percentile(100)),
      "duración media": secs(
        load.durations.reduce((a, b) => a + b, 0) / Math.max(1, load.durations.length),
      ),
    },
  });
  console.log(`Tiempo total del lote: ${secs(load.wallMs)} · memoria del proceso: ${rss()}`);
  for (const failure of load.failures) console.log(`✖ ${failure}`);

  const ok = load.failures.length === 0 && p95Load <= budget;
  console.log(
    ok
      ? `✔ Sin degradación: ${SESSIONS}/${SESSIONS} victorias y p95 ${fmt(p95Load)} ≤ ${fmt(budget)}`
      : `✖ Degradación: ${load.durations.length}/${SESSIONS} victorias, p95 ${fmt(p95Load)} (límite ${fmt(budget)})`,
  );
  await server?.gracefullyShutdown(false);
  process.exit(ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
