import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import { createInMemoryGameAccessStore, type InMemoryGameAccessPurchase } from "@escaperoom/shared/game-access";
import { signGameAccessToken, readGameAccessTokenConfig } from "@escaperoom/shared/game-access-token";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import { GAME_ROOM_NAME } from "../src/constants";
import { configureGameAccessRuntime } from "../src/game/access-runtime";
import { loadReyAldricRoomPackage } from "../src/game/room-packages";
import { GameRoom, type GameMilestone } from "../src/rooms/game-room";
import { getFreePort } from "./helpers/free-port";
import { devTestGameToken } from "./helpers/game-token";

/**
 * `GameRoom` autenticada por `gameToken` (C-4/B-4, auditoría 2026-09-24):
 * sin token se rechaza el `create`; con un token de compra se juega la
 * versión exacta comprada.
 *
 * La partida de una compra se gasta al TERMINAR, no al crear (decisión del
 * README): `onCreate` solo RECLAMA (escritura condicional); `game_ended`
 * CONSUME; `onDispose` sin terminar LIBERA; una reclamación "en curso" más
 * vieja que el margen de caducidad (servidor caído sin `onDispose`) se puede
 * volver a reclamar.
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

/** Fila de compra en memoria: libre por defecto (ni reclamada ni consumida). */
function purchaseRow(id: string): InMemoryGameAccessPurchase {
  return {
    id,
    playSessionStartedAt: null,
    playSessionEndedAt: null,
    playSessionColyseusId: null,
    playSessionHeartbeatAt: null,
  };
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

/** Dispara el hito `game_ended` de una room real (protegido; accesible solo en tests). */
function endGame(room: GameRoom): void {
  const milestone: GameMilestone = { kind: "game_ended", result: "victory", at: 0, elapsedMs: 0, hintsUsed: 0 };
  (room as unknown as { onMilestone: (m: GameMilestone) => void }).onMilestone(milestone);
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

  it("juega la versión exacta comprada y reclama (no consume) la partida", async () => {
    const purchases = [purchaseRow("purchase-1")];
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
    expect(purchases[0]!.playSessionEndedAt).toBeNull();
    expect(store.claimedRoomIdByPurchase.get("purchase-1")).toBe(room.roomId);
  });

  it("rechaza una segunda room para la misma compra mientras la primera sigue en curso", async () => {
    const purchases = [purchaseRow("purchase-1")];
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

  it("dos creaciones simultáneas de la misma compra: solo una gana", async () => {
    const purchases = [purchaseRow("purchase-1")];
    const store = createInMemoryGameAccessStore({
      packages: { [OTHER_ROOM_VERSION_ID]: otherPackage() },
      purchases,
    });
    configureGameAccessRuntime(store);

    const results = await Promise.allSettled([
      colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
        gameToken: purchaseToken("purchase-1", OTHER_ROOM_VERSION_ID),
      }),
      colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
        gameToken: purchaseToken("purchase-1", OTHER_ROOM_VERSION_ID),
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("si la partida termina (game_ended), la compra queda consumida para siempre", async () => {
    const purchases = [purchaseRow("purchase-1")];
    const store = createInMemoryGameAccessStore({
      packages: { [OTHER_ROOM_VERSION_ID]: otherPackage() },
      purchases,
    });
    configureGameAccessRuntime(store);

    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
      gameToken: purchaseToken("purchase-1", OTHER_ROOM_VERSION_ID),
    });
    endGame(room);
    await expect.poll(() => purchases[0]!.playSessionEndedAt).not.toBeNull();

    // Cerrar esa room ya no libera nada: está consumida, no "en curso".
    await room.disconnect();
    expect(purchases[0]!.playSessionStartedAt).not.toBeNull();
    expect(purchases[0]!.playSessionColyseusId).not.toBeNull();

    // Y ninguna nueva room puede reclamarla, ni siquiera pasado el margen de caducidad.
    await expect(
      colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
        gameToken: purchaseToken("purchase-1", OTHER_ROOM_VERSION_ID),
      }),
    ).rejects.toThrow();
  });

  it("si la room se cierra SIN terminar la partida, la compra se libera (se puede reintentar)", async () => {
    const purchases = [purchaseRow("purchase-1")];
    const store = createInMemoryGameAccessStore({
      packages: { [OTHER_ROOM_VERSION_ID]: otherPackage() },
      purchases,
    });
    configureGameAccessRuntime(store);

    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
      gameToken: purchaseToken("purchase-1", OTHER_ROOM_VERSION_ID),
    });
    expect(purchases[0]!.playSessionStartedAt).not.toBeNull();

    await room.disconnect();
    expect(purchases[0]!.playSessionStartedAt).toBeNull();
    expect(purchases[0]!.playSessionEndedAt).toBeNull();
    expect(purchases[0]!.playSessionColyseusId).toBeNull();

    // Libre: una nueva room la reclama sin problema.
    const retry = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
      gameToken: purchaseToken("purchase-1", OTHER_ROOM_VERSION_ID),
    });
    expect(purchases[0]!.playSessionColyseusId).toBe(retry.roomId);
  });

  it("una reclamación 'en curso' caducada (servidor caído sin onDispose) se puede retomar", async () => {
    let now = Date.now();
    const purchases = [purchaseRow("purchase-1")];
    const store = createInMemoryGameAccessStore({
      packages: { [OTHER_ROOM_VERSION_ID]: otherPackage() },
      purchases,
      now: () => new Date(now),
      staleAfterSeconds: 1,
    });
    configureGameAccessRuntime(store);

    const roomA = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
      gameToken: purchaseToken("purchase-1", OTHER_ROOM_VERSION_ID),
    });
    expect(purchases[0]!.playSessionColyseusId).toBe(roomA.roomId);

    // Antes de caducar: una segunda room se rechaza.
    await expect(
      colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
        gameToken: purchaseToken("purchase-1", OTHER_ROOM_VERSION_ID),
      }),
    ).rejects.toThrow();

    now += 2_000; // pasado el margen de 1 s, sin que `roomA` ejecutara `onDispose`.
    const roomB = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {
      gameToken: purchaseToken("purchase-1", OTHER_ROOM_VERSION_ID),
    });
    expect(purchases[0]!.playSessionColyseusId).toBe(roomB.roomId);
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
    const purchases = [purchaseRow("purchase-1"), purchaseRow("purchase-2")];
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
    const purchases = [purchaseRow("purchase-1")];
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
