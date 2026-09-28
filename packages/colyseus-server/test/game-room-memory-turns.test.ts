import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import type { MemoryPublicView } from "@escaperoom/shared/templates";
import { GAME_MESSAGES } from "../src/constants";
import { loadReyAldricRoomPackage } from "../src/game/room-packages";
import { GameRoom, type GameRoomOptions } from "../src/rooms/game-room";
import { getFreePort } from "./helpers/free-port";
import { devTestGameToken } from "./helpers/game-token";

/**
 * Encargo memory-turnos: `turnMode: "per_player"` no debe bloquear la
 * partida cuando el turno cae en alguien que no puede jugarlo (sin el panel
 * abierto o desconectado). Se prueba sobre una `GameRoom` real, con un
 * paquete propio derivado del fixture del Rey Aldric (que sigue con
 * `turnMode: "shared"`, sin tocar) donde `p-copas-memoria` pasa a
 * `per_player` y `maxFlipsPerTurn: 1` — así CUALQUIER volteo agota el turno
 * de inmediato (nunca puede haber acierto con una sola carta vista), sin
 * depender del reparto aleatorio de símbolos para forzar un fallo.
 */

const MEMORY_TURNS_ROOM_NAME = "game_memory_turns_test";
const MEMORY_PUZZLE_ID = "p-copas-memoria";

const baseRoyAldric = loadReyAldricRoomPackage();
const perPlayerMemoryPackage: RoomPackage = parseRoomPackage({
  ...baseRoyAldric,
  meta: { ...baseRoyAldric.meta, id: "sala-memory-turnos" },
  puzzles: baseRoyAldric.puzzles.map((puzzle) =>
    puzzle.id === MEMORY_PUZZLE_ID
      ? { ...puzzle, turnMode: "per_player", maxFlipsPerTurn: 1 }
      : puzzle,
  ),
} as unknown);

class MemoryTurnsRoom extends GameRoom {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- firma exigida por GameRoom
  protected override loadRoomPackage(options: GameRoomOptions): RoomPackage {
    return perPlayerMemoryPackage;
  }
}

let colyseus: ColyseusTestServer;

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(MEMORY_TURNS_ROOM_NAME, MemoryTurnsRoom);
  },
});

beforeAll(async () => {
  colyseus = await boot(config, await getFreePort());
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

function createRoom() {
  return colyseus.createRoom<MemoryTurnsRoom>(MEMORY_TURNS_ROOM_NAME, {
    gameToken: devTestGameToken(),
  });
}

function join(room: MemoryTurnsRoom, options: object = {}) {
  return colyseus.connectTo(room, { gameToken: devTestGameToken(), ...options });
}

type TestClient = Awaited<ReturnType<typeof join>>;

interface Point {
  x: number;
  y: number;
}

/** Camina en pasos cortos (≤ 2,5 celdas) hasta `to` (igual que game-room.test.ts). */
async function walk(room: MemoryTurnsRoom, client: TestClient, to: Point): Promise<void> {
  const player = room.state.players.get(client.sessionId)!;
  const from = { x: player.x, y: player.y };
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2.5));
  for (let step = 1; step <= steps; step += 1) {
    client.send(GAME_MESSAGES.move, {
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    });
  }
  await expect
    .poll(() => {
      const current = room.state.players.get(client.sessionId)!;
      return Math.hypot(current.x - to.x, current.y - to.y);
    })
    .toBeLessThan(0.01);
}

/** Placas cooperativas: desbloquean la puerta de la bodega (un jugador en cada una). */
async function solvePlates(room: MemoryTurnsRoom, a: TestClient, b: TestClient): Promise<void> {
  await walk(room, a, { x: 6, y: 11 });
  await walk(room, b, { x: 14, y: 11 });
  await expect.poll(() => b.state.puzzles.get("p-placas-estatuas")?.state).toBe("solved");
}

async function enterBodega(room: MemoryTurnsRoom, client: TestClient): Promise<void> {
  await walk(room, client, { x: 10, y: 12 });
  client.send(GAME_MESSAGES.move, { x: 0, y: 0, roomId: "bodega" });
  await expect.poll(() => room.state.players.get(client.sessionId)?.roomId).toBe("bodega");
}

async function startGame(): Promise<{ room: MemoryTurnsRoom; a: TestClient; b: TestClient }> {
  const room = await createRoom();
  const a = await join(room, { name: "Ana" });
  const b = await join(room, { name: "Bruno" });
  a.send(GAME_MESSAGES.setReady, { ready: true });
  b.send(GAME_MESSAGES.setReady, { ready: true });
  await expect.poll(() => room.state.players.get(b.sessionId)?.ready).toBe(true);
  a.send(GAME_MESSAGES.startGame, {});
  await expect.poll(() => a.state.phase).toBe("starting");
  a.send(GAME_MESSAGES.enterMap, {});
  b.send(GAME_MESSAGES.enterMap, {});
  await expect.poll(() => b.state.phase).toBe("playing");
  await expect.poll(() => room.state.players.get(b.sessionId)?.inMap).toBe(true);
  return { room, a, b };
}

interface PuzzleViewMessage {
  puzzleId: string;
  view: MemoryPublicView;
}

/** Abre el panel del `memory` y devuelve la vista inicial (con los ids de las cartas). */
async function openMemoryPanel(client: TestClient): Promise<PuzzleViewMessage> {
  const opened = client.waitForMessage(GAME_MESSAGES.puzzleView);
  client.send(GAME_MESSAGES.puzzleOpen, { puzzleId: MEMORY_PUZZLE_ID });
  return (await opened) as PuzzleViewMessage;
}

interface AttemptResultMessage {
  puzzleId: string;
  ok: boolean;
  outcome: string;
  error?: string;
}

/**
 * Voltea una carta y espera el resultado del intento y la vista actualizada
 * de CADA `watcher` (por defecto, solo quien vuelca; `maxFlipsPerTurn: 1`,
 * así que SIEMPRE agota el turno). Hay que pasar TODOS los clientes con el
 * panel abierto en ese momento como `watchers`: `refreshOpenPanels` manda la
 * vista nueva a cada uno de ellos, y si no se consume aquí se queda en cola
 * y contamina la siguiente espera de ESE cliente con una vista vieja.
 */
async function flip(
  client: TestClient,
  cardId: string,
  watchers: readonly TestClient[] = [client],
): Promise<{ attempt: AttemptResultMessage; views: Map<TestClient, PuzzleViewMessage> }> {
  const attempted = client.waitForMessage(GAME_MESSAGES.attemptResult);
  const viewedBy = watchers.map(
    (watcher) => [watcher, watcher.waitForMessage(GAME_MESSAGES.puzzleView)] as const,
  );
  client.send(GAME_MESSAGES.puzzleAttempt, {
    puzzleId: MEMORY_PUZZLE_ID,
    attempt: { flip: cardId },
  });
  const [attempt, ...views] = await Promise.all([
    attempted,
    ...viewedBy.map(([, promise]) => promise),
  ]);
  const byWatcher = new Map<TestClient, PuzzleViewMessage>();
  viewedBy.forEach(([watcher], index) => byWatcher.set(watcher, views[index] as PuzzleViewMessage));
  return { attempt: attempt as AttemptResultMessage, views: byWatcher };
}

describe("GameRoom — memory por turnos (per_player) no se bloquea", () => {
  it("2 jugadores con el panel abierto: el turno rota entre ellos", async () => {
    const { room, a, b } = await startGame();
    await solvePlates(room, a, b);
    await enterBodega(room, a);
    await enterBodega(room, b);
    const opened = await openMemoryPanel(a);
    await openMemoryPanel(b);
    const cardIds = opened.view.cards.map((card) => card.id);

    const first = await flip(a, cardIds[0]!, [a, b]);
    expect(first.attempt.outcome).toBe("turn_ended");
    expect(first.views.get(a)!.view.currentPlayerId).toBe(b.sessionId);

    const second = await flip(b, cardIds[1]!, [a, b]);
    expect(second.attempt.outcome).toBe("turn_ended");
    expect(second.views.get(b)!.view.currentPlayerId).toBe(a.sessionId);
  });

  it("1 con el panel abierto y el otro en otra sala: no se bloquea, el turno siempre vuelve a él", async () => {
    const { room, a, b } = await startGame();
    await solvePlates(room, a, b);
    await enterBodega(room, a);
    // Bruno se queda en la sala inicial: nunca abre el panel del memory.
    const opened = await openMemoryPanel(a);
    const cardIds = opened.view.cards.map((card) => card.id);

    // El primer volteo SÍ cambia la vista (el turno pasa de libre a Ana), así
    // que se espera; los siguientes dejan el turno igual (sigue siendo la
    // única elegible) y el servidor no reenvía una vista idéntica — la
    // prueba de que no se bloquea es que CADA intento sigue dando
    // `turn_ended`, nunca `not_your_turn`.
    const first = await flip(a, cardIds[0]!);
    expect(first.attempt.outcome).toBe("turn_ended");
    expect(first.views.get(a)!.view.currentPlayerId).toBe(a.sessionId);

    for (const cardId of cardIds.slice(1, 3)) {
      // `puzzleAttempt` está limitado a 2/s (specs/11 §9): sin esperar entre
      // volteos, la ráfaga dispara `RATE_LIMITED` en vez de `attemptResult`.
      await new Promise((resolve) => setTimeout(resolve, 550));
      const attempted = a.waitForMessage(GAME_MESSAGES.attemptResult);
      a.send(GAME_MESSAGES.puzzleAttempt, {
        puzzleId: MEMORY_PUZZLE_ID,
        attempt: { flip: cardId },
      });
      const attempt = (await attempted) as AttemptResultMessage;
      expect(attempt.outcome).toBe("turn_ended");
      expect(attempt.error).toBeUndefined();
    }
    expect(room.state.players.get(b.sessionId)?.roomId).not.toBe("bodega");
  });

  it("el dueño del turno se desconecta: el turno pasa al siguiente elegible", async () => {
    const { room, a, b } = await startGame();
    await solvePlates(room, a, b);
    await enterBodega(room, a);
    await enterBodega(room, b);
    const opened = await openMemoryPanel(a);
    await openMemoryPanel(b);
    const cardIds = opened.view.cards.map((card) => card.id);

    const first = await flip(a, cardIds[0]!, [a, b]);
    expect(first.views.get(a)!.view.currentPlayerId).toBe(b.sessionId);

    const reassigned = a.waitForMessage(GAME_MESSAGES.puzzleView);
    await b.leave(false); // caída de red, NO consentida: dispara `onDrop`.
    await expect.poll(() => room.state.players.get(b.sessionId)?.connected).toBe(false);
    const viewMsg = (await reassigned) as PuzzleViewMessage;
    expect(viewMsg.view.currentPlayerId).toBe(a.sessionId);

    // Ana puede seguir jugando sin esperar a nadie (el turno no cambia de
    // dueño, así que el servidor no reenvía una vista idéntica: basta con
    // comprobar que el intento sigue dando `turn_ended`, no `not_your_turn`).
    const attempted = a.waitForMessage(GAME_MESSAGES.attemptResult);
    a.send(GAME_MESSAGES.puzzleAttempt, {
      puzzleId: MEMORY_PUZZLE_ID,
      attempt: { flip: cardIds[1]! },
    });
    const next = (await attempted) as AttemptResultMessage;
    expect(next.outcome).toBe("turn_ended");
  });

  it("el dueño del turno cierra el panel: el turno pasa al siguiente elegible", async () => {
    const { room, a, b } = await startGame();
    await solvePlates(room, a, b);
    await enterBodega(room, a);
    await enterBodega(room, b);
    const opened = await openMemoryPanel(a);
    await openMemoryPanel(b);
    const cardIds = opened.view.cards.map((card) => card.id);

    const first = await flip(a, cardIds[0]!, [a, b]);
    expect(first.views.get(a)!.view.currentPlayerId).toBe(b.sessionId);

    const reassigned = a.waitForMessage(GAME_MESSAGES.puzzleView);
    b.send(GAME_MESSAGES.puzzleClose, { puzzleId: MEMORY_PUZZLE_ID });
    const viewMsg = (await reassigned) as PuzzleViewMessage;
    expect(viewMsg.view.currentPlayerId).toBe(a.sessionId);
  });
});
