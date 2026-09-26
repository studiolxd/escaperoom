import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import { createInMemoryGameAccessStore, type InMemoryGameAccessPurchase } from "@escaperoom/shared/game-access";
import { signGameAccessToken, readGameAccessTokenConfig } from "@escaperoom/shared/game-access-token";
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
  return colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, { gameToken: devTestGameToken(), ...options });
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
    { kind: "purchase", purchaseId: "purchase-min", userId: "user:ana", roomVersionId: ROOM_VERSION_ID },
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
    await expect.poll(() => a.state.phase).toBe("playing");

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
    expect(await leftForA).toMatchObject({ playerId: b.sessionId, name: "Bruno", reason: "kicked" });
    await expect.poll(() => room.state.players.has(b.sessionId)).toBe(false);

    // No puede volver a entrar con el mismo `seatKey` (identidad del bloqueo, C-13).
    await expect(
      colyseus.connectTo(room, { gameToken: devTestGameToken(), name: "Bruno", seatKey: "seat-bruno-2" }),
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
