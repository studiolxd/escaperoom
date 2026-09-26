import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import {
  createInMemoryGameAccessStore,
  type InMemoryGameAccessPurchase,
} from "@escaperoom/shared/game-access";
import {
  readGameAccessTokenConfig,
  signGameAccessToken,
} from "@escaperoom/shared/game-access-token";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import { GAME_MESSAGES, GAME_ROOM_NAME } from "../src/constants";
import { configureGameAccessRuntime } from "../src/game/access-runtime";
import { loadReyAldricRoomPackage } from "../src/game/room-packages";
import { GameRoom } from "../src/rooms/game-room";
import { getFreePort } from "./helpers/free-port";
import { devTestGameToken } from "./helpers/game-token";

/**
 * Partidas abandonadas (decisión del usuario 2026-09-26, specs/11 §8.2,
 * ADR-043): en juego (`starting`/`playing`) la plaza se reserva
 * indefinidamente al desconectar (C-2), así que sin duración (ADR-038/#169)
 * nada cerraba la room si TODOS se iban. Igual que
 * `game-room-reconnection.test.ts`, los plazos reales (1 h) son demasiado
 * lentos para un test: `FastAbandonedRoom` los acorta con los mismos puntos
 * de extensión que usará producción.
 */

const FAST_SECONDS = 0.15;
/** Ventana de abandono más generosa: la usa el único test que reconecta A MITAD de la cuenta
 * atrás — con `FAST_SECONDS` (150 ms) el margen entre "aún no" y "ya cerró" es demasiado
 * ajustado frente a la latencia real de `leave()`/`reconnect()` del SDK sobre el socket. */
const ABANDON_RACE_SECONDS = 0.6;
const FAST_ROOM_NAME = "game_abandoned_test";

class FastAbandonedRoom extends GameRoom {
  protected override lobbyReconnectGraceSeconds(): number {
    return FAST_SECONDS;
  }
  protected override hostReassignGraceSeconds(): number {
    return FAST_SECONDS;
  }
  protected override resultsRoomLifetimeSeconds(): number {
    return FAST_SECONDS;
  }
  protected override abandonedGameTimeoutSeconds(): number {
    return FAST_SECONDS;
  }
}

const RACE_ROOM_NAME = "game_abandoned_race_test";

class RaceAbandonedRoom extends FastAbandonedRoom {
  protected override abandonedGameTimeoutSeconds(): number {
    return ABANDON_RACE_SECONDS;
  }
}

let colyseus: ColyseusTestServer;
const ROOM_VERSION_ID = "55555555-5555-5555-5555-555555555555";

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(GAME_ROOM_NAME, GameRoom);
    server.define(FAST_ROOM_NAME, FastAbandonedRoom);
    server.define(RACE_ROOM_NAME, RaceAbandonedRoom);
  },
});

beforeAll(async () => {
  colyseus = await boot(config, await getFreePort());
});

afterEach(async () => {
  await colyseus.cleanup();
  configureGameAccessRuntime(undefined);
});

afterAll(async () => {
  await colyseus.shutdown();
});

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createFastRoom() {
  return colyseus.createRoom<FastAbandonedRoom>(FAST_ROOM_NAME, { gameToken: devTestGameToken() });
}

function join(room: FastAbandonedRoom, options: object = {}) {
  return colyseus.connectTo(room, { gameToken: devTestGameToken(), ...options });
}

type TestClient = Awaited<ReturnType<typeof join>>;

/** C-13: marca a ambos "Listo" antes de que `a` (anfitrión) empiece. */
async function readyAndStart(room: FastAbandonedRoom, a: TestClient, b: TestClient): Promise<void> {
  a.send(GAME_MESSAGES.setReady, { ready: true });
  b.send(GAME_MESSAGES.setReady, { ready: true });
  await expect.poll(() => room.state.players.get(b.sessionId)?.ready).toBe(true);
  a.send(GAME_MESSAGES.startGame, {});
  await expect.poll(() => room.state.phase).toBe("starting");
  a.send(GAME_MESSAGES.enterMap, {});
  b.send(GAME_MESSAGES.enterMap, {});
  await expect.poll(() => room.state.phase).toBe("playing");
}

function purchaseRow(id: string): InMemoryGameAccessPurchase {
  return {
    id,
    playSessionStartedAt: null,
    playSessionEndedAt: null,
    playSessionColyseusId: null,
    playSessionHeartbeatAt: null,
  };
}

function purchaseToken(purchaseId: string): string {
  const gameAccessConfig = readGameAccessTokenConfig()!;
  const now = Date.now();
  return signGameAccessToken(
    gameAccessConfig.secret,
    { kind: "purchase", purchaseId, userId: "user:ana", roomVersionId: ROOM_VERSION_ID },
    { now, expiresAt: now + 15 * 60 * 1000 },
  );
}

function noDurationPackage(): RoomPackage {
  const fixture = loadReyAldricRoomPackage();
  return parseRoomPackage({
    ...fixture,
    meta: { ...fixture.meta, id: "sala-sin-duracion", title: "Sala sin duración", timeLimitMinutes: null },
  } as unknown);
}

describe("GameRoom — partidas abandonadas (specs/11 §8.2, ADR-043)", () => {
  it("todos desconectados: se cierra a los N s como abandonada y la room se destruye después", async () => {
    const room = await createFastRoom();
    const a = await join(room, { name: "Ana" });
    const b = await join(room, { name: "Bruno" });
    await readyAndStart(room, a, b);

    const tokenA = a.reconnectionToken;
    const tokenB = b.reconnectionToken;
    await a.leave(false);
    await b.leave(false);
    await expect.poll(() => room.state.players.get(a.sessionId)?.connected).toBe(false);
    await expect.poll(() => room.state.players.get(b.sessionId)?.connected).toBe(false);

    // Sigue viva y con la plaza reservada justo tras desconectarse los dos.
    expect(room.state.result).toBe("");

    // "abandoned" es el vocabulario del motor (`GameEndResult`); `toSessionResult`
    // lo traduce a "aborted" para el hito/la analítica (ver `end-game.ts`).
    await expect.poll(() => room.state.result, { timeout: 3000 }).toBe("abandoned");
    // Ya no admite ninguna reconexión (mismo camino que un fin normal, §8.1).
    await expect(colyseus.sdk.reconnect(tokenA)).rejects.toThrow();
    await expect(colyseus.sdk.reconnect(tokenB)).rejects.toThrow();

    // Pasado el margen de resultados, la room se ha cerrado.
    await sleep(FAST_SECONDS * 1000 + 300);
    await expect(
      colyseus.sdk.joinById(room.roomId, { gameToken: devTestGameToken() }),
    ).rejects.toThrow();
  });

  it("una reconexión antes del plazo cancela la cuenta atrás", async () => {
    const room = await colyseus.createRoom<RaceAbandonedRoom>(RACE_ROOM_NAME, {
      gameToken: devTestGameToken(),
    });
    const a = await colyseus.connectTo(room, { gameToken: devTestGameToken(), name: "Ana" });
    const b = await colyseus.connectTo(room, { gameToken: devTestGameToken(), name: "Bruno" });
    await readyAndStart(room, a, b);

    const tokenA = a.reconnectionToken;
    await a.leave(false);
    await b.leave(false);
    await expect.poll(() => room.state.players.get(b.sessionId)?.connected).toBe(false);

    // Vuelve a mitad de la cuenta atrás de abandono: la cancela.
    await sleep((ABANDON_RACE_SECONDS * 1000) / 2);
    await colyseus.sdk.reconnect(tokenA);
    await expect.poll(() => room.state.players.get(a.sessionId)?.connected).toBe(true);

    // Pasado el plazo original, la partida sigue viva (no se cerró).
    await sleep(ABANDON_RACE_SECONDS * 1000);
    expect(room.state.result).toBe("");
    expect(room.state.phase).toBe("playing");
  });

  it("con un jugador conectado, la partida nunca se cierra por abandono", async () => {
    const room = await createFastRoom();
    const a = await join(room, { name: "Ana" });
    const b = await join(room, { name: "Bruno" });
    await readyAndStart(room, a, b);

    // Solo Ana se va; Bruno se queda conectado todo el rato.
    await a.leave(false);
    await expect.poll(() => room.state.players.get(a.sessionId)?.connected).toBe(false);

    await sleep(FAST_SECONDS * 1000 * 3);
    expect(room.state.result).toBe("");
    expect(room.state.phase).toBe("playing");
  });

  it("una sala sin duración también se cierra por abandono", async () => {
    const purchases = [purchaseRow("purchase-1")];
    const store = createInMemoryGameAccessStore({
      packages: { [ROOM_VERSION_ID]: noDurationPackage() },
      purchases,
    });
    configureGameAccessRuntime(store);

    const room = await colyseus.createRoom<FastAbandonedRoom>(FAST_ROOM_NAME, {
      gameToken: purchaseToken("purchase-1"),
    });
    const a = await colyseus.connectTo(room, {
      gameToken: purchaseToken("purchase-1"),
      name: "Ana",
    });
    const b = await colyseus.connectTo(room, {
      gameToken: purchaseToken("purchase-1"),
      name: "Bruno",
    });
    await readyAndStart(room, a, b);
    expect(room.state.endsAt).toBe(0); // sin duración: sin fecha de fin de cronómetro.

    await a.leave(false);
    await b.leave(false);
    await expect.poll(() => room.state.result, { timeout: 3000 }).toBe("abandoned");
  });

  it("compra B2C: el abandono LIBERA la reclamación (no la consume)", async () => {
    const purchases = [purchaseRow("purchase-1")];
    const store = createInMemoryGameAccessStore({
      packages: { [ROOM_VERSION_ID]: noDurationPackage() },
      purchases,
    });
    configureGameAccessRuntime(store);

    const room = await colyseus.createRoom<FastAbandonedRoom>(FAST_ROOM_NAME, {
      gameToken: purchaseToken("purchase-1"),
    });
    const a = await colyseus.connectTo(room, {
      gameToken: purchaseToken("purchase-1"),
      name: "Ana",
    });
    const b = await colyseus.connectTo(room, {
      gameToken: purchaseToken("purchase-1"),
      name: "Bruno",
    });
    await readyAndStart(room, a, b);
    expect(purchases[0]!.playSessionStartedAt).not.toBeNull();

    await a.leave(false);
    await b.leave(false);
    await expect.poll(() => room.state.result, { timeout: 3000 }).toBe("abandoned");

    // Liberada: se puede volver a jugar. NO consumida (`playSessionEndedAt` sigue `null`).
    await expect.poll(() => purchases[0]!.playSessionStartedAt).toBeNull();
    expect(purchases[0]!.playSessionEndedAt).toBeNull();
    expect(purchases[0]!.playSessionColyseusId).toBeNull();

    const retry = await colyseus.createRoom<FastAbandonedRoom>(FAST_ROOM_NAME, {
      gameToken: purchaseToken("purchase-1"),
    });
    expect(purchases[0]!.playSessionColyseusId).toBe(retry.roomId);
  });
});
