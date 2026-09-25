import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import type { Rule, RoomPackage } from "@escaperoom/shared/schemas";
import { GAME_MESSAGES, GAME_ROOM_NAME } from "../src/constants";
import { loadReyAldricRoomPackage } from "../src/game/room-packages";
import { GameRoom, type GameRoomOptions } from "../src/rooms/game-room";
import { getFreePort } from "./helpers/free-port";
import { devTestGameToken } from "./helpers/game-token";

/**
 * Reconexión, anfitrión y fin de partida (C-1/C-2, bloque 4, auditoría
 * 2026-09-24): plazos reales de producto (60 s de gracia, partida entera para
 * la plaza, 5 min de resultados) son demasiado lentos para un test, así que
 * `FastGameRoom` los acorta con los mismos puntos de extensión que usarán
 * `GameRoom`/`EventRoom` en producción.
 */

const FAST_SECONDS = 0.15;
const FAST_ROOM_NAME = "game_reconnect_test";

/** Regla que termina la partida en victoria nada más empezar, sin resolver nada (test-only). */
const INSTANT_WIN_RULE: Rule = {
  id: "test-instant-win",
  priority: 1000,
  once: true,
  trigger: { type: "on_game_start" },
  conditions: [],
  actions: [{ type: "end_game", result: "victory" }],
};

const baseRoyAldric = loadReyAldricRoomPackage();
const instantWinPackage: RoomPackage = {
  ...baseRoyAldric,
  rules: [...baseRoyAldric.rules, INSTANT_WIN_RULE],
};

class FastGameRoom extends GameRoom {
  protected override lobbyReconnectGraceSeconds(): number {
    return FAST_SECONDS;
  }
  protected override hostReassignGraceSeconds(): number {
    return FAST_SECONDS;
  }
  protected override resultsRoomLifetimeSeconds(): number {
    return FAST_SECONDS;
  }
}

class FastInstantWinRoom extends FastGameRoom {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- firma exigida por GameRoom
  protected override loadRoomPackage(options: GameRoomOptions): RoomPackage {
    return instantWinPackage;
  }
}

let colyseus: ColyseusTestServer;

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(GAME_ROOM_NAME, GameRoom);
    server.define(FAST_ROOM_NAME, FastGameRoom);
    server.define("game_instant_win_test", FastInstantWinRoom);
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

function createFastRoom() {
  return colyseus.createRoom<FastGameRoom>(FAST_ROOM_NAME, { gameToken: devTestGameToken() });
}

function join(room: FastGameRoom, options: object = {}) {
  return colyseus.connectTo(room, { gameToken: devTestGameToken(), ...options });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("GameRoom — reconexión con gracia (C-2)", () => {
  it("en juego: se conserva inventario, personaje y posición al reconectar", async () => {
    const room = await createFastRoom();
    const a = await join(room, { name: "Ana" });
    const b = await join(room, { name: "Bruno" });
    a.send(GAME_MESSAGES.startGame, {});
    await expect.poll(() => b.state.phase).toBe("playing");

    const granted = b.waitForMessage(GAME_MESSAGES.itemGranted);
    a.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    await granted;
    await expect
      .poll(() => [...(room.state.inventories.get(a.sessionId)?.items ?? [])])
      .toEqual(["llave-bronce"]);
    const beforeCharacter = room.state.players.get(a.sessionId)!.characterId;
    const beforeSessionId = a.sessionId;
    const token = a.reconnectionToken;

    await a.leave(false); // caída de red, NO consentida: dispara `onDrop` + gracia.
    await expect.poll(() => room.state.players.get(beforeSessionId)?.connected).toBe(false);
    // La plaza sigue reservada (en juego la gracia es indefinida hasta el fin).
    expect(room.state.players.has(beforeSessionId)).toBe(true);

    const reconnected = await colyseus.sdk.reconnect(token);
    expect(reconnected.sessionId).toBe(beforeSessionId);
    await expect.poll(() => room.state.players.get(beforeSessionId)?.connected).toBe(true);
    expect(room.state.players.get(beforeSessionId)!.characterId).toBe(beforeCharacter);
    expect([...(room.state.inventories.get(beforeSessionId)?.items ?? [])]).toEqual(["llave-bronce"]);
  });

  it("sin el token de reconexión, el mismo seatKey recupera la plaza (recarga/pestaña reabierta)", async () => {
    const room = await createFastRoom();
    const a = await join(room, { name: "Ana", seatKey: "seat-a" });
    const b = await join(room, { name: "Bruno" });
    a.send(GAME_MESSAGES.startGame, {});
    await expect.poll(() => b.state.phase).toBe("playing");

    const granted = b.waitForMessage(GAME_MESSAGES.itemGranted);
    a.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    await granted;
    const beforeCharacter = room.state.players.get(a.sessionId)!.characterId;
    const beforeSessionId = a.sessionId;

    // El cliente perdió el `reconnectionToken` nativo (pestaña cerrada y
    // reabierta: el SDK no lo persiste solo); vuelve con el mismo `seatKey`.
    await a.leave(false);
    await expect.poll(() => room.state.players.get(beforeSessionId)?.connected).toBe(false);

    const reopened = await colyseus.sdk.joinById(room.roomId, {
      gameToken: devTestGameToken(),
      name: "Ana",
      seatKey: "seat-a",
    });
    expect(reopened.sessionId).not.toBe(beforeSessionId);
    await expect.poll(() => room.state.players.has(beforeSessionId)).toBe(false);
    const player = room.state.players.get(reopened.sessionId)!;
    expect(player.characterId).toBe(beforeCharacter);
    expect([...(room.state.inventories.get(reopened.sessionId)?.items ?? [])]).toEqual([
      "llave-bronce",
    ]);
    expect(room.state.players.size).toBe(2); // no sumó una plaza más.
  });

  it("un seatKey distinto SÍ es un jugador nuevo (no hereda ninguna plaza)", async () => {
    const room = await createFastRoom();
    await join(room, { name: "Ana", seatKey: "seat-a" });
    const c = await join(room, { name: "Carla", seatKey: "seat-c" });
    await expect.poll(() => room.state.players.size).toBe(2);
    expect(room.state.players.get(c.sessionId)?.name).toBe("Carla");
  });

  it("en el lobby: el desconectado libera su plaza tras la gracia y ya no puede reconectar", async () => {
    const room = await createFastRoom();
    const a = await join(room, { name: "Ana" });
    await join(room, { name: "Bruno" });
    const sessionId = a.sessionId;
    const token = a.reconnectionToken;

    await a.leave(false);
    await expect.poll(() => room.state.players.has(sessionId)).toBe(false);
    await expect(colyseus.sdk.reconnect(token)).rejects.toThrow();
  });

  it("anfitrión: se reasigna tras la gracia; si el original vuelve antes del fin, recupera el puesto", async () => {
    const room = await createFastRoom();
    const a = await join(room, { name: "Ana" });
    const b = await join(room, { name: "Bruno" });
    a.send(GAME_MESSAGES.startGame, {});
    await expect.poll(() => b.state.phase).toBe("playing");
    expect(room.state.hostId).toBe(a.sessionId);

    const hostId = a.sessionId;
    const token = a.reconnectionToken;
    await a.leave(false);
    await expect.poll(() => room.state.hostId).toBe(b.sessionId);

    // Vuelve antes de que la partida termine: recupera el puesto.
    await colyseus.sdk.reconnect(token);
    await expect.poll(() => room.state.hostId).toBe(hostId);
  });
});

describe("GameRoom — fin de partida y cierre (specs/11 §8.1)", () => {
  it("tras game_ended no se admite reconexión y la room se cierra pasado el margen", async () => {
    const room = await colyseus.createRoom<FastInstantWinRoom>("game_instant_win_test", {
      gameToken: devTestGameToken(),
    });
    const a = await colyseus.connectTo(room, { gameToken: devTestGameToken(), name: "Ana" });
    const token = a.reconnectionToken;
    const ended = a.waitForMessage(GAME_MESSAGES.gameEnded);
    a.send(GAME_MESSAGES.startGame, {});
    expect(await ended).toMatchObject({ result: "victory" });

    // Aunque caiga justo tras el fin, no hay ventana de reconexión.
    await a.leave(false);
    await expect(colyseus.sdk.reconnect(token)).rejects.toThrow();

    // Pasado el margen de resultados, la room se ha cerrado.
    await sleep(FAST_SECONDS * 1000 + 300);
    expect(room.state.players.size).toBeGreaterThanOrEqual(0); // la room puede haberse liberado ya
    await expect(
      colyseus.sdk.joinById(room.roomId, { gameToken: devTestGameToken() }),
    ).rejects.toThrow();
  });
});

describe("GameRoom — nombres (C-18)", () => {
  it("un nombre hecho solo de caracteres invisibles cae al nombre por defecto", async () => {
    const room = await createFastRoom();
    const zeroWidth = "​‌‍";
    const a = await join(room, { name: zeroWidth });
    await expect.poll(() => room.state.players.get(a.sessionId)?.name).toBe("Jugador 1");
  });

  it("HTML, control y zero-width se limpian a la vez, conservando el texto real", async () => {
    const room = await createFastRoom();
    const a = await join(room, { name: "  <b>Ana</b>​  " });
    await expect.poll(() => room.state.players.get(a.sessionId)?.name).toBe("Ana");
  });
});
