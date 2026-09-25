import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import { createInMemoryGameAccessStore } from "@escaperoom/shared/game-access";
import { signGameAccessToken, readGameAccessTokenConfig } from "@escaperoom/shared/game-access-token";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import { GAME_ROOM_NAME } from "../src/constants";
import { configureGameAccessRuntime } from "../src/game/access-runtime";
import { loadReyAldricRoomPackage } from "../src/game/room-packages";
import { GameRoom } from "../src/rooms/game-room";
import { getFreePort } from "./helpers/free-port";
import { devTestGameToken } from "./helpers/game-token";

/**
 * `GameRoom` autenticada por `gameToken` (C-4/B-4, auditoría 2026-09-24):
 * sin token se rechaza el `create`; con un token de compra se juega la
 * versión exacta comprada y se reclama la única partida de la compra
 * (`playSessionStartedAt`); una segunda compra reutilizada se rechaza.
 */

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(GAME_ROOM_NAME, GameRoom);
  },
});

let colyseus: ColyseusTestServer;

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

const OTHER_ROOM_VERSION_ID = "22222222-2222-2222-2222-222222222222";

function otherPackage(): RoomPackage {
  const fixture = loadReyAldricRoomPackage();
  return parseRoomPackage({
    ...fixture,
    meta: { ...fixture.meta, id: "sala-comprada", title: "Sala comprada" },
  } as unknown);
}

function purchaseToken(purchaseId: string, roomVersionId: string): string {
  const config = readGameAccessTokenConfig()!;
  const now = Date.now();
  return signGameAccessToken(
    config.secret,
    { kind: "purchase", purchaseId, userId: "user:ana", roomVersionId },
    { now, expiresAt: now + 15 * 60 * 1000 },
  );
}

describe("GameRoom — gameToken (C-4/B-4)", () => {
  it("rechaza crear la room sin gameToken", async () => {
    await expect(colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {})).rejects.toThrow();
  });

  it("rechaza un gameToken con firma inválida", async () => {
    await expect(
      colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, { gameToken: "a.b.c" }),
    ).rejects.toThrow();
  });

  it("juega la versión exacta comprada y reclama la única partida de la compra", async () => {
    const purchases = [{ id: "purchase-1", playSessionStartedAt: null }];
    const store = createInMemoryGameAccessStore({
      packages: { [OTHER_ROOM_VERSION_ID]: otherPackage() },
      purchases,
    });
    configureGameAccessRuntime(store);

    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
      gameToken: purchaseToken("purchase-1", OTHER_ROOM_VERSION_ID),
    });
    expect(room.state.roomPackageId).toBe("sala-comprada");
    expect(purchases[0]!.playSessionStartedAt).not.toBeNull();
    expect(store.claimedRoomIdByPurchase.get("purchase-1")).toBe(room.roomId);
  });

  it("rechaza una segunda room para la misma compra (una compra = una partida)", async () => {
    const purchases = [{ id: "purchase-1", playSessionStartedAt: null }];
    const store = createInMemoryGameAccessStore({
      packages: { [OTHER_ROOM_VERSION_ID]: otherPackage() },
      purchases,
    });
    configureGameAccessRuntime(store);

    await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
      gameToken: purchaseToken("purchase-1", OTHER_ROOM_VERSION_ID),
    });
    await expect(
      colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
        gameToken: purchaseToken("purchase-1", OTHER_ROOM_VERSION_ID),
      }),
    ).rejects.toThrow();
  });

  it("rechaza una compra sin runtime configurado (sin Postgres)", async () => {
    configureGameAccessRuntime(null);
    await expect(
      colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
        gameToken: purchaseToken("purchase-1", OTHER_ROOM_VERSION_ID),
      }),
    ).rejects.toThrow();
  });

  it("un gameToken de compra de otra room no permite unirse por joinById", async () => {
    const purchases = [
      { id: "purchase-1", playSessionStartedAt: null },
      { id: "purchase-2", playSessionStartedAt: null },
    ];
    const store = createInMemoryGameAccessStore({
      packages: { [OTHER_ROOM_VERSION_ID]: otherPackage() },
      purchases,
    });
    configureGameAccessRuntime(store);

    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
      gameToken: purchaseToken("purchase-1", OTHER_ROOM_VERSION_ID),
    });
    await expect(
      colyseus.sdk.joinById(room.roomId, {
        gameToken: purchaseToken("purchase-2", OTHER_ROOM_VERSION_ID),
      }),
    ).rejects.toThrow();
  });

  it("el mismo gameToken de compra sí puede reconectar/unirse por joinById", async () => {
    const purchases = [{ id: "purchase-1", playSessionStartedAt: null }];
    const store = createInMemoryGameAccessStore({
      packages: { [OTHER_ROOM_VERSION_ID]: otherPackage() },
      purchases,
    });
    configureGameAccessRuntime(store);

    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
      gameToken: purchaseToken("purchase-1", OTHER_ROOM_VERSION_ID),
    });
    const client = await colyseus.sdk.joinById(room.roomId, {
      gameToken: purchaseToken("purchase-1", OTHER_ROOM_VERSION_ID),
    });
    expect(client.sessionId).toBeTruthy();
  });

  it("una partida de prueba (dev_test) sigue jugando el fixture sin compra", async () => {
    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
      gameToken: devTestGameToken(),
    });
    expect(room.state.roomPackageId).toBe("room-rey-aldric");
  });
});
