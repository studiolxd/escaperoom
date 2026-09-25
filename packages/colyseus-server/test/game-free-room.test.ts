import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import { createInMemoryGameAccessStore } from "@escaperoom/shared/game-access";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import { GAME_ROOM_NAME } from "../src/constants";
import { configureGameAccessRuntime } from "../src/game/access-runtime";
import { loadReyAldricRoomPackage } from "../src/game/room-packages";
import { GameRoom } from "../src/rooms/game-room";
import { getFreePort } from "./helpers/free-port";
import { testGameToken } from "./helpers/game-token";

/**
 * `GameRoom` con `gameToken` `kind: "free"` (punto i de "CTA Jugar",
 * `docs/DEUDA.md`): sala realmente gratis, sin `purchase` ni `claimPlaySession`
 * — cualquiera puede pedir tantos tokens como el rate limit de la web deje
 * (eso se prueba en `packages/web/test`, no aquí), y la `GameRoom` los acepta
 * todos mientras el `roomVersionId` cargue un paquete real.
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

const FREE_ROOM_ID = "33333333-3333-3333-3333-333333333333";
const FREE_ROOM_VERSION_ID = "44444444-4444-4444-4444-444444444444";

function freeRoomPackage(): RoomPackage {
  const fixture = loadReyAldricRoomPackage();
  return parseRoomPackage({
    ...fixture,
    meta: { ...fixture.meta, id: "sala-gratis", title: "Sala gratis" },
  } as unknown);
}

function freeToken(roomId: string, roomVersionId: string): string {
  return testGameToken({ kind: "free", roomId, roomVersionId });
}

describe("GameRoom — gameToken kind: free (punto i, CTA Jugar)", () => {
  it("juega la versión publicada sin reclamar ninguna compra", async () => {
    const store = createInMemoryGameAccessStore({
      packages: { [FREE_ROOM_VERSION_ID]: freeRoomPackage() },
      purchases: [],
    });
    configureGameAccessRuntime(store);

    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
      gameToken: freeToken(FREE_ROOM_ID, FREE_ROOM_VERSION_ID),
    });
    expect(room.state.roomPackageId).toBe("sala-gratis");
    expect(store.claimedRoomIdByPurchase.size).toBe(0);
  });

  it("varias rooms libres para la misma sala gratis, sin rechazo por 'ya en curso'", async () => {
    const store = createInMemoryGameAccessStore({
      packages: { [FREE_ROOM_VERSION_ID]: freeRoomPackage() },
      purchases: [],
    });
    configureGameAccessRuntime(store);

    const roomA = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
      gameToken: freeToken(FREE_ROOM_ID, FREE_ROOM_VERSION_ID),
    });
    const roomB = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
      gameToken: freeToken(FREE_ROOM_ID, FREE_ROOM_VERSION_ID),
    });
    expect(roomA.roomId).not.toBe(roomB.roomId);
  });

  it("rechaza sin runtime configurado (sin Postgres)", async () => {
    configureGameAccessRuntime(null);
    await expect(
      colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
        gameToken: freeToken(FREE_ROOM_ID, FREE_ROOM_VERSION_ID),
      }),
    ).rejects.toThrow();
  });

  it("un roomVersionId sin paquete publicado se rechaza", async () => {
    const store = createInMemoryGameAccessStore({ packages: {}, purchases: [] });
    configureGameAccessRuntime(store);
    await expect(
      colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
        gameToken: freeToken(FREE_ROOM_ID, FREE_ROOM_VERSION_ID),
      }),
    ).rejects.toThrow();
  });

  it("un gameToken de sala gratis de otra sala no permite unirse por joinById", async () => {
    const otherVersionId = "55555555-5555-5555-5555-555555555555";
    const store = createInMemoryGameAccessStore({
      packages: {
        [FREE_ROOM_VERSION_ID]: freeRoomPackage(),
        [otherVersionId]: freeRoomPackage(),
      },
      purchases: [],
    });
    configureGameAccessRuntime(store);

    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
      gameToken: freeToken(FREE_ROOM_ID, FREE_ROOM_VERSION_ID),
    });
    await expect(
      colyseus.sdk.joinById(room.roomId, {
        gameToken: freeToken("otra-sala", otherVersionId),
      }),
    ).rejects.toThrow();
  });

  it("el mismo gameToken de sala gratis sí puede unirse por joinById", async () => {
    const store = createInMemoryGameAccessStore({
      packages: { [FREE_ROOM_VERSION_ID]: freeRoomPackage() },
      purchases: [],
    });
    configureGameAccessRuntime(store);

    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
      gameToken: freeToken(FREE_ROOM_ID, FREE_ROOM_VERSION_ID),
    });
    const client = await colyseus.sdk.joinById(room.roomId, {
      gameToken: freeToken(FREE_ROOM_ID, FREE_ROOM_VERSION_ID),
    });
    expect(client.sessionId).toBeTruthy();
  });
});
