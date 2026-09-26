import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import { createInMemoryGameAccessStore, type InMemoryGameAccessPurchase } from "@escaperoom/shared/game-access";
import { signGameAccessToken, readGameAccessTokenConfig } from "@escaperoom/shared/game-access-token";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import { GAME_MESSAGES, GAME_ROOM_NAME } from "../src/constants";
import { configureGameAccessRuntime } from "../src/game/access-runtime";
import { loadReyAldricRoomPackage } from "../src/game/room-packages";
import { GameRoom } from "../src/rooms/game-room";
import { getFreePort } from "./helpers/free-port";

/**
 * Ticket duración-salas (specs/04 §6): la `GameRoom` resuelve el límite de
 * partida de `meta.timeLimitMinutes` en vez de un `GAME_TIME_LIMIT_SEC` fijo.
 * Se prueba con una compra B2C (permite un `RoomPackage` a medida, a
 * diferencia de la room "desnuda" del fixture del Rey Aldric).
 */

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(GAME_ROOM_NAME, GameRoom);
  },
});

let colyseus: ColyseusTestServer;
const ROOM_VERSION_ID = "33333333-3333-3333-3333-333333333333";

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

function packageWithTimeLimit(timeLimitMinutes: number | null | undefined): RoomPackage {
  const fixture = loadReyAldricRoomPackage();
  return parseRoomPackage({
    ...fixture,
    meta: { ...fixture.meta, id: "sala-duracion", title: "Sala duración", timeLimitMinutes },
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

function purchaseToken(purchaseId: string): string {
  const gameAccessConfig = readGameAccessTokenConfig()!;
  const now = Date.now();
  return signGameAccessToken(
    gameAccessConfig.secret,
    { kind: "purchase", purchaseId, userId: "user:ana", roomVersionId: ROOM_VERSION_ID },
    { now, expiresAt: now + 15 * 60 * 1000 },
  );
}

async function startPurchasedGame(roomPackage: RoomPackage) {
  const store = createInMemoryGameAccessStore({
    packages: { [ROOM_VERSION_ID]: roomPackage },
    purchases: [purchaseRow("purchase-1")],
  });
  configureGameAccessRuntime(store);
  const token = purchaseToken("purchase-1");
  const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, { gameToken: token });
  const client = await colyseus.connectTo(room, { gameToken: token });
  client.send(GAME_MESSAGES.startGame, {});
  await expect.poll(() => client.state.phase).toBe("playing");
  return { room, client };
}

describe("GameRoom — duración de partida (meta.timeLimitMinutes)", () => {
  it("ausente: cae al valor por defecto retrocompatible (60 min)", async () => {
    const fixture = loadReyAldricRoomPackage();
    const { timeLimitMinutes: _omitted, ...metaWithoutTimeLimit } = fixture.meta;
    const { room, client } = await startPurchasedGame(
      parseRoomPackage({
        ...fixture,
        meta: { ...metaWithoutTimeLimit, id: "sala-duracion" },
      } as unknown),
    );
    expect(client.state.endsAt - client.state.startedAt).toBe(60 * 60 * 1000);
    await room.disconnect();
  });

  it("null: sin duración — endsAt se queda a 0 (sin cronómetro)", async () => {
    const { room, client } = await startPurchasedGame(packageWithTimeLimit(null));
    expect(client.state.endsAt).toBe(0);
    await room.disconnect();
  });

  it("entero: fija el límite exacto declarado por la sala, sin tope", async () => {
    const { room, client } = await startPurchasedGame(packageWithTimeLimit(180));
    expect(client.state.endsAt - client.state.startedAt).toBe(180 * 60 * 1000);
    await room.disconnect();
  });
});
