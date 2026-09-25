import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import {
  CHAT_MESSAGE,
  CHAT_RATE_LIMITED_ERROR,
  ERROR_MESSAGE,
  GAME_ERRORS,
  GAME_MESSAGES,
  GAME_ROOM_NAME,
  GAME_TICK_MS,
} from "../src/constants";
import { MEDIA_TOKEN_MESSAGE, MEDIA_TOKEN_REQUEST_MESSAGE } from "../src/media/index";
import { GameRoom } from "../src/rooms/game-room";
import { getFreePort } from "./helpers/free-port";
import { devTestGameToken } from "./helpers/game-token";

/**
 * Integración de la `GameRoom` (ticket 2.8): la partida del Rey Aldric sobre
 * Colyseus real (puerto libre del SO). Cubre la conexión de las plantillas a
 * los mensajes de specs/11 y las proyecciones públicas por jugador; la ruta
 * completa hasta la victoria la cubre el test de `RoomSession` en `shared`
 * (sin red) y, por protocolo, el E2E del ticket 2.12.
 */

let colyseus: ColyseusTestServer;

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(GAME_ROOM_NAME, GameRoom);
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

/** Crea una `GameRoom` con el `gameToken` de prueba que exige `onCreate` (C-4). */
function createGameRoom(options: Record<string, unknown> = {}) {
  return colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, { gameToken: devTestGameToken(), ...options });
}

/** Conecta un cliente de test tipado con el estado de la `GameRoom` (mismo `gameToken`). */
function join(room: GameRoom, options: object = {}) {
  return colyseus.connectTo(room, { gameToken: devTestGameToken(), ...options });
}

type TestClient = Awaited<ReturnType<typeof join>>;

interface Point {
  x: number;
  y: number;
}

/** Camina en pasos cortos (≤ 2,5 celdas, por debajo del salto máximo) hasta `to`. */
async function walk(room: GameRoom, client: TestClient, to: Point): Promise<void> {
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

async function startGame(): Promise<{ room: GameRoom; a: TestClient; b: TestClient }> {
  const room = await createGameRoom();
  const a = await join(room, { name: "Ana" });
  const b = await join(room, { name: "Bruno" });
  const intro = a.waitForMessage(GAME_MESSAGES.dialogShow);
  a.send(GAME_MESSAGES.startGame, {});
  expect(await intro).toEqual({ dialogId: "d-intro" });
  await expect.poll(() => b.state.phase).toBe("playing");
  return { room, a, b };
}

/** Placas cooperativas: un jugador en cada una. */
async function solvePlates(room: GameRoom, a: TestClient, b: TestClient): Promise<void> {
  await walk(room, a, { x: 6, y: 11 });
  await walk(room, b, { x: 14, y: 11 });
  await expect.poll(() => b.state.puzzles.get("p-placas-estatuas")?.state).toBe("solved");
}

async function enterBodega(room: GameRoom, client: TestClient): Promise<void> {
  await walk(room, client, { x: 10, y: 12 });
  client.send(GAME_MESSAGES.move, { x: 0, y: 0, roomId: "bodega" });
  await expect.poll(() => room.state.players.get(client.sessionId)?.roomId).toBe("bodega");
}

describe("GameRoom — Rey Aldric sobre Colyseus", () => {
  it("solo el anfitrión empieza; la intro y el cronómetro llegan a todos", async () => {
    const room = await createGameRoom();
    const a = await join(room);
    const b = await join(room);

    const denied = b.waitForMessage(ERROR_MESSAGE);
    b.send(GAME_MESSAGES.startGame, {});
    expect((await denied).code).toBe(GAME_ERRORS.permissionDenied);

    const blocked = a.waitForMessage(ERROR_MESSAGE);
    a.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    expect((await blocked).code).toBe(GAME_ERRORS.invalidState);

    a.send(GAME_MESSAGES.startGame, {});
    await expect.poll(() => b.state.phase).toBe("playing");
    expect(b.state.endsAt - b.state.startedAt).toBe(3600 * 1000);
    expect(b.state.players.size).toBe(2);
    expect(b.state.objects.get("puerta-bodega")).toBe("closed");
    expect(b.state.puzzles.get("p-reja-mirillas")?.state).toBe("locked");
  });

  it("placas cooperativas por posición abren la puerta; una puerta cerrada no se cruza", async () => {
    const { room, a, b } = await startGame();

    const locked = a.waitForMessage(ERROR_MESSAGE);
    await walk(room, a, { x: 10, y: 12 });
    a.send(GAME_MESSAGES.move, { x: 0, y: 0, roomId: "bodega" });
    expect((await locked).code).toBe(GAME_ERRORS.roomLocked);

    const opened = b.waitForMessage(GAME_MESSAGES.puzzleSolved);
    await solvePlates(room, a, b);
    expect(await opened).toMatchObject({
      puzzleId: "p-placas-estatuas",
      unlocks: ["puerta-bodega"],
    });
    await expect.poll(() => a.state.objects.get("puerta-bodega")).toBe("open");
    expect(a.state.objects.get("placa-izq")).toBe("down");

    await enterBodega(room, a);
    await expect.poll(() => b.state.players.get(a.sessionId)?.roomId).toBe("bodega");
  });

  it("C-6: cruzar en sentido inverso también exige estar cerca de la puerta declarada", async () => {
    const { room, a, b } = await startGame();
    await solvePlates(room, a, b);
    await enterBodega(room, a);

    // La puerta ("puerta-bodega") solo está declarada en el lado del salón;
    // cruzar en el sentido inverso (bodega → salón) también exige estar
    // cerca de esa posición, no solo tener la puerta abierta.
    const rejectedBack = a.waitForMessage(ERROR_MESSAGE);
    a.send(GAME_MESSAGES.move, { x: 0, y: 0, roomId: "salon-trono" });
    expect((await rejectedBack).code).toBe(GAME_ERRORS.roomLocked);
    // Deja pasar la ventana del rate limit (10 `move`/s) antes de la ráfaga
    // del `walk`: no es lo que prueba este test.
    await new Promise((resolve) => setTimeout(resolve, 1050));
    await walk(room, a, { x: 10, y: 11 });
    a.send(GAME_MESSAGES.move, { x: 0, y: 0, roomId: "salon-trono" });
    await expect.poll(() => room.state.players.get(a.sessionId)?.roomId).toBe("salon-trono");
  });

  it("C-7: hint_request de un puzzle locked de otra fase se rechaza sin dar pistas", async () => {
    const { room, a, b } = await startGame();
    await solvePlates(room, a, b);
    await enterBodega(room, a);
    await expect.poll(() => room.state.puzzles.get("p-reja-mirillas")?.state).toBe("locked");

    const rejected = a.waitForMessage(ERROR_MESSAGE);
    a.send(GAME_MESSAGES.hintRequest, { puzzleId: "p-reja-mirillas" });
    expect((await rejected).code).toBe(GAME_ERRORS.notAvailable);
  });

  it("el inventario y los candados se validan en el servidor sin filtrar el código", async () => {
    const { room, a, b } = await startGame();

    const granted = b.waitForMessage(GAME_MESSAGES.itemGranted);
    a.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    expect(await granted).toEqual({ playerId: a.sessionId, itemId: "llave-bronce" });
    await expect
      .poll(() => [...(b.state.inventories.get(a.sessionId)?.items ?? [])])
      .toEqual(["llave-bronce"]);

    const wrong = a.waitForMessage(GAME_MESSAGES.attemptResult);
    a.send(GAME_MESSAGES.puzzleAttempt, { puzzleId: "p-candado-arca", attempt: { code: "0000" } });
    expect(await wrong).toMatchObject({ ok: false, error: "wrong_code" });
    await expect.poll(() => b.state.puzzles.get("p-candado-arca")?.attempts).toBe(1);

    // El sello vive en las Catacumbas: desde el Salón no se puede ni intentar.
    const elsewhere = a.waitForMessage(ERROR_MESSAGE);
    a.send(GAME_MESSAGES.puzzleAttempt, { puzzleId: "p-sello-final", attempt: { code: "4538" } });
    expect((await elsewhere).code).toBe(GAME_ERRORS.notAvailable);

    const serialized = JSON.stringify(b.state.toJSON());
    expect(serialized).not.toContain("4732");
    expect(serialized).not.toContain("4538");
    expect(serialized).not.toContain("solution");
    expect(room.state.puzzles.get("p-sello-final")?.state).toBe("locked");
  });

  it("memory y split_clue: cada jugador recibe solo lo que le corresponde", async () => {
    const { room, a, b } = await startGame();
    await solvePlates(room, a, b);
    await enterBodega(room, a);
    await enterBodega(room, b);

    // Memory: el panel no trae símbolos boca abajo; el volteo revela solo al emisor.
    const opened = a.waitForMessage(GAME_MESSAGES.puzzleView);
    a.send(GAME_MESSAGES.puzzleOpen, { puzzleId: "p-copas-memoria" });
    const view = (await opened) as { view: { cards: { id: string; symbol: string | null }[] } };
    expect(view.view.cards).toHaveLength(6);
    expect(view.view.cards.every((card) => card.symbol === null)).toBe(true);

    const flipped = a.waitForMessage(GAME_MESSAGES.attemptResult);
    a.send(GAME_MESSAGES.puzzleAttempt, {
      puzzleId: "p-copas-memoria",
      attempt: { flip: view.view.cards[0]!.id },
    });
    const flip = (await flipped) as { ok: boolean; revealedSymbol?: string };
    expect(flip.ok).toBe(true);
    expect(["uva", "sol", "llave"]).toContain(flip.revealedSymbol);
    await expect.poll(() => b.state.puzzles.get("p-copas-memoria")?.state).toBe("in_progress");
    expect(JSON.stringify(b.state.toJSON())).not.toContain(`"${flip.revealedSymbol}"`);

    // Mirillas: bloqueadas hasta resolver las copas, pero cada una deja ver su mitad.
    await walk(room, a, { x: 9, y: 10 });
    await walk(room, b, { x: 13, y: 10 });
    const fragmentsA = a.waitForMessage(GAME_MESSAGES.splitFragments);
    a.send(GAME_MESSAGES.splitView, {});
    expect(await fragmentsA).toEqual({
      puzzleId: "p-reja-mirillas",
      viewpointId: "mirilla-a",
      fragments: { 0: "luna", 2: "luna" },
    });
    const fragmentsB = b.waitForMessage(GAME_MESSAGES.splitFragments);
    b.send(GAME_MESSAGES.splitView, {});
    expect(await fragmentsB).toEqual({
      puzzleId: "p-reja-mirillas",
      viewpointId: "mirilla-b",
      fragments: { 1: "corona", 3: "espada" },
    });

    const early = b.waitForMessage(GAME_MESSAGES.attemptResult);
    b.send(GAME_MESSAGES.puzzleAttempt, {
      puzzleId: "p-reja-mirillas",
      attempt: { symbols: ["luna", "corona", "luna", "espada"] },
    });
    expect(await early).toMatchObject({ ok: false, error: "not_available" });
    expect(room.state.objects.get("reja-escalera")).toBe("closed");
  });

  it("C-9: un panel abierto no se reenvía en cada tick si no cambió", async () => {
    const { room, a, b } = await startGame();
    await solvePlates(room, a, b);
    await enterBodega(room, a);
    await enterBodega(room, b);

    const opened = a.waitForMessage(GAME_MESSAGES.puzzleView);
    a.send(GAME_MESSAGES.puzzleOpen, { puzzleId: "p-copas-memoria" });
    await opened;

    let resent = 0;
    const off = a.onMessage(GAME_MESSAGES.puzzleView, () => {
      resent += 1;
    });
    // Deja pasar varios ticks (250 ms) sin tocar el puzzle: no debe reenviarse.
    await new Promise((resolve) => setTimeout(resolve, GAME_TICK_MS * 6));
    off();
    expect(resent).toBe(0);
  });

  it("C-9: `state.clock` no se sincroniza en cada tick de simulación (como mucho 1 vez/s)", async () => {
    const { a } = await startGame();
    const clockPatches: number[] = [];
    a.onStateChange((state) => {
      clockPatches.push(state.clock);
    });
    await new Promise((resolve) => setTimeout(resolve, GAME_TICK_MS * 8)); // 2 s de ticks
    // Con 8 ticks de 250 ms (2 s) y una sincronización como mucho por segundo,
    // el reloj no debería avanzar más de un par de veces (frente a 8 antes).
    const distinctClocks = new Set(clockPatches).size;
    expect(distinctClocks).toBeLessThanOrEqual(3);
  });

  it("chat de la partida (specs/11 §4.4): desde el lobby, con autor y rate limit", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana" });
    const b = await join(room, { name: "Bruno" });

    a.send(CHAT_MESSAGE, { text: "¿Empezamos?" });
    await expect.poll(() => b.state.chat.length).toBe(1);
    expect(b.state.chat[0]).toMatchObject({
      authorId: a.sessionId,
      authorName: "Ana",
      text: "¿Empezamos?",
      filtered: false,
    });

    const limited = a.waitForMessage(ERROR_MESSAGE);
    a.send(CHAT_MESSAGE, { text: "uno" });
    a.send(CHAT_MESSAGE, { text: "dos" });
    expect((await limited).code).toBe(CHAT_RATE_LIMITED_ERROR);
  });

  it("firma el token de medios de la partida (ticket 2.2); sin claves, configured:false", async () => {
    const saved = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"].map(
      (key) => [key, process.env[key]] as const,
    );
    for (const [key] of saved) delete process.env[key];
    try {
      const room = await createGameRoom();
      const a = await join(room);
      const token = a.waitForMessage(MEDIA_TOKEN_MESSAGE);
      a.send(MEDIA_TOKEN_REQUEST_MESSAGE, { role: "player" });
      expect(await token).toMatchObject({
        configured: false,
        token: null,
        identity: a.sessionId,
        role: "player",
      });
    } finally {
      for (const [key, value] of saved) if (value !== undefined) process.env[key] = value;
    }
  });

  it("rechaza mensajes con forma inválida", async () => {
    const { a } = await startGame();
    const invalid = a.waitForMessage(ERROR_MESSAGE);
    a.send(GAME_MESSAGES.puzzleAttempt, { puzzleId: "p-candado-arca", attempt: { code: 4732 } });
    expect((await invalid).code).toBe(GAME_ERRORS.invalidState);
  });
});
