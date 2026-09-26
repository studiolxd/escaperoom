import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import {
  createInMemoryGameAccessStore,
  type InMemoryGameAccessPurchase,
} from "@escaperoom/shared/game-access";
import {
  signGameAccessToken,
  readGameAccessTokenConfig,
} from "@escaperoom/shared/game-access-token";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import { ERROR_MESSAGE, GAME_ERRORS, GAME_MESSAGES, GAME_ROOM_NAME } from "../src/constants";
import { configureGameAccessRuntime } from "../src/game/access-runtime";
import { loadReyAldricRoomPackage } from "../src/game/room-packages";
import { GameRoom } from "../src/rooms/game-room";
import { getFreePort } from "./helpers/free-port";
import { devTestGameToken } from "./helpers/game-token";

/**
 * C-13 (encargo lobby-c13, decisiones del usuario 2026-09-26): "Listo",
 * mínimo de jugadores, "Empezar igualmente" (`force`) y `kick`/`player_left`.
 * specs/11 §4.1/§4.5.
 */

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(GAME_ROOM_NAME, GameRoom);
  },
});

let colyseus: ColyseusTestServer;
const ROOM_VERSION_ID = "44444444-4444-4444-4444-444444444444";

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

function createGameRoom(options: Record<string, unknown> = {}) {
  return colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
    gameToken: devTestGameToken(),
    ...options,
  });
}

function join(room: GameRoom, options: object = {}) {
  return colyseus.connectTo(room, { gameToken: devTestGameToken(), ...options });
}

/** Paquete a medida con `meta.players.min = 2` (el fixture del Rey Aldric tiene `min: 1`). */
function packageWithMinPlayers(min: number): RoomPackage {
  const fixture = loadReyAldricRoomPackage();
  return parseRoomPackage({
    ...fixture,
    meta: { ...fixture.meta, id: "sala-lobby-min", title: "Sala mínimo", players: { min, max: 4 } },
  } as unknown);
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

/** Room con `min` jugadores exigidos, vía una compra B2C (permite un `RoomPackage` a medida). */
async function createRoomWithMinPlayers(min: number) {
  const roomPackage = packageWithMinPlayers(min);
  const store = createInMemoryGameAccessStore({
    packages: { [ROOM_VERSION_ID]: roomPackage },
    purchases: [purchaseRow("purchase-min")],
  });
  configureGameAccessRuntime(store);
  const gameAccessConfig = readGameAccessTokenConfig()!;
  const now = Date.now();
  const token = signGameAccessToken(
    gameAccessConfig.secret,
    {
      kind: "purchase",
      purchaseId: "purchase-min",
      userId: "user:ana",
      roomVersionId: ROOM_VERSION_ID,
    },
    { now, expiresAt: now + 15 * 60 * 1000 },
  );
  const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, { gameToken: token });
  const client = await colyseus.connectTo(room, { gameToken: token });
  return { room, client };
}

describe("GameRoom — lobby: «Listo» (C-13)", () => {
  it("marca/desmarca «Listo»; cambiar de personaje lo quita", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana", characterId: "caballero-m" });

    a.send(GAME_MESSAGES.setReady, { ready: true });
    await expect.poll(() => room.state.players.get(a.sessionId)?.ready).toBe(true);

    a.send(GAME_MESSAGES.selectCharacter, { characterId: "maniqui" });
    await expect.poll(() => room.state.players.get(a.sessionId)?.characterId).toBe("maniqui");
    expect(room.state.players.get(a.sessionId)?.ready).toBe(false);
  });

  it("«Listo» no tiene efecto fuera del lobby", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana" });
    a.send(GAME_MESSAGES.setReady, { ready: true });
    await expect.poll(() => room.state.players.get(a.sessionId)?.ready).toBe(true);
    a.send(GAME_MESSAGES.startGame, {});
    await expect.poll(() => a.state.phase).toBe("starting");

    const rejected = a.waitForMessage(ERROR_MESSAGE);
    a.send(GAME_MESSAGES.setReady, { ready: false });
    expect((await rejected).code).toBe(GAME_ERRORS.invalidState);
  });
});

describe("GameRoom — lobby: empezar (mínimo y «Listo»), C-13", () => {
  it("el anfitrión no puede empezar si hay conectados que no están «Listo»", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana" });
    await join(room, { name: "Bruno" });
    a.send(GAME_MESSAGES.setReady, { ready: true });
    // Bruno no se marca «Listo».

    const rejected = a.waitForMessage(ERROR_MESSAGE);
    a.send(GAME_MESSAGES.startGame, {});
    expect((await rejected).code).toBe(GAME_ERRORS.playersNotReady);
    expect(room.state.phase).toBe("lobby");
  });

  it("«Empezar igualmente» (force) empieza aunque falten «Listo»", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana" });
    await join(room, { name: "Bruno" });

    a.send(GAME_MESSAGES.startGame, { force: true });
    await expect.poll(() => room.state.phase).toBe("starting");
    a.send(GAME_MESSAGES.enterMap, {});
    await expect.poll(() => room.state.phase).toBe("playing");
  });

  it("por debajo del mínimo de jugadores, ni «Empezar igualmente» arranca", async () => {
    const { room, client } = await createRoomWithMinPlayers(2);
    client.send(GAME_MESSAGES.setReady, { ready: true });
    await expect.poll(() => room.state.players.get(client.sessionId)?.ready).toBe(true);

    const rejected = client.waitForMessage(ERROR_MESSAGE);
    client.send(GAME_MESSAGES.startGame, { force: true });
    expect((await rejected).code).toBe(GAME_ERRORS.minPlayersNotMet);
    expect(room.state.phase).toBe("lobby");
  });
});

describe("GameRoom — lobby: kick y player_left (C-13)", () => {
  it("el anfitrión expulsa a otro jugador; se avisa a todos y no puede volver", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana", seatKey: "seat-bruno" });
    const b = await join(room, { name: "Bruno", seatKey: "seat-bruno-2" });

    const leftForA = a.waitForMessage(GAME_MESSAGES.playerLeft);
    a.send(GAME_MESSAGES.kick, { playerId: b.sessionId });
    expect(await leftForA).toMatchObject({
      playerId: b.sessionId,
      name: "Bruno",
      reason: "kicked",
    });
    await expect.poll(() => room.state.players.has(b.sessionId)).toBe(false);

    // No puede volver a entrar con el mismo `seatKey` (identidad del bloqueo, C-13).
    await expect(
      colyseus.connectTo(room, {
        gameToken: devTestGameToken(),
        name: "Bruno",
        seatKey: "seat-bruno-2",
      }),
    ).rejects.toThrow();
  });

  it("solo el anfitrión puede expulsar; no se puede expulsar a uno mismo", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana" });
    const b = await join(room, { name: "Bruno" });

    const deniedForB = b.waitForMessage(ERROR_MESSAGE);
    b.send(GAME_MESSAGES.kick, { playerId: a.sessionId });
    expect((await deniedForB).code).toBe(GAME_ERRORS.permissionDenied);

    const deniedForA = a.waitForMessage(ERROR_MESSAGE);
    a.send(GAME_MESSAGES.kick, { playerId: a.sessionId });
    expect((await deniedForA).code).toBe(GAME_ERRORS.kickTargetInvalid);
  });

  it("cuando alguien sale voluntariamente, se avisa con reason: left", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana" });
    const b = await join(room, { name: "Bruno" });

    const leftForA = a.waitForMessage(GAME_MESSAGES.playerLeft);
    await b.leave(true);
    expect(await leftForA).toMatchObject({ playerId: b.sessionId, name: "Bruno", reason: "left" });
  });
});

/** Paquete con una sala de espera diseñada (`kind: "lobby"`) en primera posición. */
function packageWithDesignedLobby(): RoomPackage {
  const fixture = loadReyAldricRoomPackage();
  return parseRoomPackage({
    ...fixture,
    meta: { ...fixture.meta, id: "sala-con-lobby" },
    map: {
      ...fixture.map,
      rooms: [
        {
          id: "vestibulo",
          name: "Vestíbulo",
          kind: "lobby",
          grid: { cols: 6, rows: 5 },
          layers: [],
          decorations: [],
          spawnPoints: [1, 2, 3, 4].map((n) => ({ id: `s${n}`, x: n, y: 3 })),
          lighting: [],
        },
        ...fixture.map.rooms,
      ],
    },
  } as unknown);
}

async function createRoomWithPackage(roomPackage: RoomPackage) {
  const store = createInMemoryGameAccessStore({
    packages: { [ROOM_VERSION_ID]: roomPackage },
    purchases: [purchaseRow("purchase-lobby")],
  });
  configureGameAccessRuntime(store);
  const now = Date.now();
  const token = signGameAccessToken(
    readGameAccessTokenConfig()!.secret,
    {
      kind: "purchase",
      purchaseId: "purchase-lobby",
      userId: "user:ana",
      roomVersionId: ROOM_VERSION_ID,
    },
    { now, expiresAt: now + 15 * 60 * 1000 },
  );
  const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, { gameToken: token });
  return { room, token };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("GameRoom — sala de espera, introducción y reloj (encargo lobby-diseño)", () => {
  it("sin lobby diseñado, los jugadores aparecen en el generado, se mueven y se ven", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana" });
    const b = await join(room, { name: "Bruno" });

    await expect.poll(() => b.state.players.get(a.sessionId)?.roomId).toBe("lobby");
    expect(room.state.players.get(a.sessionId)?.inMap).toBe(false);
    const start = room.state.players.get(a.sessionId)!;
    const target = { x: start.x + 1, y: start.y };
    a.send(GAME_MESSAGES.move, target);
    // Bruno ve moverse a Ana dentro del lobby.
    await expect.poll(() => b.state.players.get(a.sessionId)?.x).toBe(target.x);

    // Desde el lobby no se cruza a otra habitación ni se interactúa.
    const locked = a.waitForMessage(ERROR_MESSAGE);
    a.send(GAME_MESSAGES.move, { x: 10, y: 12, roomId: "salon-trono" });
    expect((await locked).code).toBe(GAME_ERRORS.roomLocked);
    const blocked = a.waitForMessage(ERROR_MESSAGE);
    a.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    expect((await blocked).code).toBe(GAME_ERRORS.invalidState);
  });

  it("con lobby diseñado, se aparece en él y se entra al mapa por la habitación inicial", async () => {
    const { room, token } = await createRoomWithPackage(packageWithDesignedLobby());
    const a = await colyseus.connectTo(room, { gameToken: token, name: "Ana" });
    await expect.poll(() => room.state.players.get(a.sessionId)?.roomId).toBe("vestibulo");

    a.send(GAME_MESSAGES.setReady, { ready: true });
    await expect.poll(() => room.state.players.get(a.sessionId)?.ready).toBe(true);
    a.send(GAME_MESSAGES.startGame, {});
    await expect.poll(() => room.state.phase).toBe("starting");
    a.send(GAME_MESSAGES.enterMap, {});
    await expect.poll(() => room.state.players.get(a.sessionId)?.roomId).toBe("salon-trono");
    expect(room.state.players.get(a.sessionId)?.inMap).toBe(true);
  });

  it("enter_map antes de «Empezar» se rechaza", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana" });
    const rejected = a.waitForMessage(ERROR_MESSAGE);
    a.send(GAME_MESSAGES.enterMap, {});
    expect((await rejected).code).toBe(GAME_ERRORS.invalidState);
    expect(room.state.players.get(a.sessionId)?.inMap).toBe(false);
  });

  it("el reloj arranca cuando el PRIMER jugador entra al mapa, no al pulsar «Empezar»", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana" });
    const b = await join(room, { name: "Bruno" });
    a.send(GAME_MESSAGES.startGame, { force: true });
    await expect.poll(() => room.state.phase).toBe("starting");
    expect(room.state.startedAt).toBe(0);
    expect(room.state.endsAt).toBe(0);

    // Ana sigue leyendo la introducción: el reloj no corre todavía.
    await sleep(300);
    expect(room.state.phase).toBe("starting");
    const beforeEnter = Date.now();

    b.send(GAME_MESSAGES.enterMap, {});
    await expect.poll(() => room.state.phase).toBe("playing");
    const startedAt = room.state.startedAt;
    expect(startedAt).toBeGreaterThan(250);
    expect(room.state.endsAt - startedAt).toBe(3600 * 1000);
    expect(room.state.players.get(b.sessionId)?.inMap).toBe(true);
    expect(room.state.players.get(a.sessionId)?.inMap).toBe(false);
    expect(Date.now() - beforeEnter).toBeLessThan(5000);

    // Ana entra después: no reinicia el reloj.
    await sleep(100);
    a.send(GAME_MESSAGES.enterMap, {});
    await expect.poll(() => room.state.players.get(a.sessionId)?.inMap).toBe(true);
    expect(room.state.startedAt).toBe(startedAt);
    expect(room.state.players.get(a.sessionId)?.roomId).toBe("salon-trono");
  });

  it("quien aún no ha entrado al mapa no puede actuar en la partida", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana" });
    const b = await join(room, { name: "Bruno" });
    a.send(GAME_MESSAGES.startGame, { force: true });
    a.send(GAME_MESSAGES.enterMap, {});
    await expect.poll(() => room.state.phase).toBe("playing");

    const blocked = b.waitForMessage(ERROR_MESSAGE);
    b.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    expect((await blocked).code).toBe(GAME_ERRORS.invalidState);
  });

  it("entrada tardía: quien llega con la partida en curso entra al lobby y luego al mapa", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana" });
    a.send(GAME_MESSAGES.startGame, { force: true });
    a.send(GAME_MESSAGES.enterMap, {});
    await expect.poll(() => room.state.phase).toBe("playing");
    const startedAt = room.state.startedAt;

    const late = await join(room, { name: "Carla" });
    await expect.poll(() => room.state.players.get(late.sessionId)?.roomId).toBe("lobby");
    expect(room.state.players.get(late.sessionId)?.inMap).toBe(false);
    expect(late.state.phase).toBe("playing");

    late.send(GAME_MESSAGES.enterMap, {});
    await expect.poll(() => room.state.players.get(late.sessionId)?.inMap).toBe(true);
    expect(room.state.players.get(late.sessionId)?.roomId).toBe("salon-trono");
    expect(room.state.startedAt).toBe(startedAt);

    const granted = late.waitForMessage(GAME_MESSAGES.itemGranted);
    late.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    expect(await granted).toMatchObject({ itemId: "llave-bronce" });
  });

  it("reconexión a mitad de partida (mismo seatKey): salta lobby e introducción", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana", seatKey: "seat-ana" });
    a.send(GAME_MESSAGES.startGame, { force: true });
    a.send(GAME_MESSAGES.enterMap, {});
    await expect.poll(() => room.state.players.get(a.sessionId)?.inMap).toBe(true);

    const again = await join(room, { name: "Ana", seatKey: "seat-ana" });
    await expect.poll(() => room.state.players.get(again.sessionId)?.inMap).toBe(true);
    expect(room.state.players.get(again.sessionId)?.roomId).toBe("salon-trono");
  });

  it("startFromLobby: se puede invocar desde fuera de la room (inicio conjunto)", async () => {
    const room = await createGameRoom();
    await join(room, { name: "Ana" });
    await join(room, { name: "Bruno" });

    expect(room.startFromLobby()).toMatchObject({ ok: false, code: GAME_ERRORS.playersNotReady });
    expect(room.lobbyClosed).toBe(false);
    expect(room.startFromLobby({ force: true })).toEqual({ ok: true });
    expect(room.lobbyClosed).toBe(true);
    await expect.poll(() => room.state.phase).toBe("starting");
    expect(room.startFromLobby({ force: true })).toMatchObject({
      ok: false,
      code: GAME_ERRORS.invalidState,
    });
  });

  it("sala de 1 jugador: lobby y «Empezar» inmediato", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana" });
    a.send(GAME_MESSAGES.setReady, { ready: true });
    await expect.poll(() => room.state.players.get(a.sessionId)?.ready).toBe(true);
    a.send(GAME_MESSAGES.startGame, {});
    await expect.poll(() => room.state.phase).toBe("starting");
    a.send(GAME_MESSAGES.enterMap, {});
    await expect.poll(() => room.state.phase).toBe("playing");
  });
});
