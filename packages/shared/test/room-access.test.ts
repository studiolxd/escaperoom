import { describe, expect, it } from "vitest";
import { verifyGameAccessToken } from "../src/services/game-access-token";
import {
  ANONYMOUS_ACTOR,
  createInMemoryRoomAccessStore,
  createRoomAccessService,
  type Actor,
  type InMemoryRoomAccessPurchase,
} from "../src/services";

/**
 * `GET /api/rooms/:roomId/access` (B-4, auditoría 2026-09-24): la partida de
 * una compra se gasta al TERMINAR, no al crear (decisión del README). Tres
 * estados: libre (`playSessionStartedAt` `NULL`, o "en curso" pero caducada),
 * en curso (reclamada, no caducada: `roomId` para unirse, no crear) y
 * consumida (`playSessionEndedAt` fijado: `playable: false` para siempre).
 */

const SECRET = "test-game-access-token-secret-0123456789ab";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ROOM_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const buyer: Actor = { userId: "compradora", organizationId: null, role: "member" };

function purchase(overrides: Partial<InMemoryRoomAccessPurchase> = {}): InMemoryRoomAccessPurchase {
  return {
    userId: buyer.userId,
    roomId: ROOM_ID,
    purchaseId: "purchase-1",
    roomVersionId: ROOM_VERSION_ID,
    status: "succeeded",
    playSessionStartedAt: null,
    playSessionEndedAt: null,
    playSessionColyseusId: null,
    ...overrides,
  };
}

describe("room-access", () => {
  it("sin sesión: como si no tuviera la sala", async () => {
    const service = createRoomAccessService({
      store: createInMemoryRoomAccessStore([]),
      gameToken: { secret: SECRET, ttlSeconds: 900 },
    });
    expect(await service.getAccess(ANONYMOUS_ACTOR, ROOM_ID)).toEqual({
      owned: false,
      playable: false,
    });
  });

  it("sin compra succeeded de esa sala: owned:false", async () => {
    const service = createRoomAccessService({
      store: createInMemoryRoomAccessStore([]),
      gameToken: { secret: SECRET, ttlSeconds: 900 },
    });
    expect(await service.getAccess(buyer, ROOM_ID)).toEqual({ owned: false, playable: false });
  });

  it("libre (nunca reclamada): owned+playable, gameToken sin roomId", async () => {
    const service = createRoomAccessService({
      store: createInMemoryRoomAccessStore([purchase()]),
      gameToken: { secret: SECRET, ttlSeconds: 900 },
    });
    const access = await service.getAccess(buyer, ROOM_ID);
    expect(access.owned).toBe(true);
    expect(access.playable).toBe(true);
    expect(access.roomId).toBeUndefined();
    expect(access.gameToken).toBeTruthy();

    const verified = verifyGameAccessToken(SECRET, access.gameToken);
    expect(verified).toMatchObject({
      ok: true,
      claims: {
        kind: "purchase",
        purchaseId: "purchase-1",
        userId: buyer.userId,
        roomVersionId: ROOM_VERSION_ID,
      },
    });
  });

  it("en curso (reclamada, no caducada): playable, gameToken de la misma compra + roomId", async () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const service = createRoomAccessService({
      store: createInMemoryRoomAccessStore([
        purchase({
          playSessionStartedAt: new Date(now.getTime() - 60_000),
          playSessionColyseusId: "room-abc",
        }),
      ]),
      gameToken: { secret: SECRET, ttlSeconds: 900 },
      now: () => now,
      staleAfterSeconds: 3600,
    });
    const access = await service.getAccess(buyer, ROOM_ID);
    expect(access.owned).toBe(true);
    expect(access.playable).toBe(true);
    expect(access.roomId).toBe("room-abc");
    expect(access.gameToken).toBeTruthy();
  });

  it("en curso pero caducada (servidor caído sin onDispose): se trata como libre", async () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const service = createRoomAccessService({
      store: createInMemoryRoomAccessStore([
        purchase({
          playSessionStartedAt: new Date(now.getTime() - 7_200_000),
          playSessionColyseusId: "room-abc",
        }),
      ]),
      gameToken: { secret: SECRET, ttlSeconds: 900 },
      now: () => now,
      staleAfterSeconds: 3600,
    });
    const access = await service.getAccess(buyer, ROOM_ID);
    expect(access.owned).toBe(true);
    expect(access.playable).toBe(true);
    expect(access.roomId).toBeUndefined();
  });

  it("consumida (la partida terminó): playable:false para siempre, sin token", async () => {
    const service = createRoomAccessService({
      store: createInMemoryRoomAccessStore([
        purchase({
          playSessionStartedAt: new Date(),
          playSessionEndedAt: new Date(),
          playSessionColyseusId: "room-abc",
        }),
      ]),
      gameToken: { secret: SECRET, ttlSeconds: 900 },
    });
    const access = await service.getAccess(buyer, ROOM_ID);
    expect(access).toEqual({ owned: true, playable: false });
  });

  it("una compra pending no cuenta como acceso", async () => {
    const service = createRoomAccessService({
      store: createInMemoryRoomAccessStore([purchase({ status: "pending" })]),
      gameToken: { secret: SECRET, ttlSeconds: 900 },
    });
    expect(await service.getAccess(buyer, ROOM_ID)).toEqual({ owned: false, playable: false });
  });
});
