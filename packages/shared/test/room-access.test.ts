import { describe, expect, it } from "vitest";
import { verifyGameAccessToken } from "../src/services/game-access-token";
import {
  ANONYMOUS_ACTOR,
  createInMemoryRoomAccessStore,
  createRoomAccessService,
  type Actor,
} from "../src/services";

/**
 * `GET /api/rooms/:roomId/access` (B-4, auditoría 2026-09-24): sin compra
 * `succeeded` de esa sala no hay acceso; con una sin jugar, emite el
 * `gameToken` que la `GameRoom` exige (C-4); con la partida ya jugada,
 * `playable: false` y sin token.
 */

const SECRET = "test-game-access-token-secret-0123456789ab";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ROOM_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const buyer: Actor = { userId: "compradora", organizationId: null, role: "member" };

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

  it("compra succeeded sin jugar: owned+playable y gameToken de compra válido", async () => {
    const service = createRoomAccessService({
      store: createInMemoryRoomAccessStore([
        {
          userId: buyer.userId,
          roomId: ROOM_ID,
          purchaseId: "purchase-1",
          roomVersionId: ROOM_VERSION_ID,
          status: "succeeded",
          playSessionStartedAt: null,
        },
      ]),
      gameToken: { secret: SECRET, ttlSeconds: 900 },
    });
    const access = await service.getAccess(buyer, ROOM_ID);
    expect(access.owned).toBe(true);
    expect(access.playable).toBe(true);
    expect(access.gameToken).toBeTruthy();

    const verified = verifyGameAccessToken(SECRET, access.gameToken);
    expect(verified).toMatchObject({
      ok: true,
      claims: { kind: "purchase", purchaseId: "purchase-1", userId: buyer.userId, roomVersionId: ROOM_VERSION_ID },
    });
  });

  it("compra succeeded ya jugada (playSessionStartedAt fijado): playable:false, sin token", async () => {
    const service = createRoomAccessService({
      store: createInMemoryRoomAccessStore([
        {
          userId: buyer.userId,
          roomId: ROOM_ID,
          purchaseId: "purchase-1",
          roomVersionId: ROOM_VERSION_ID,
          status: "succeeded",
          playSessionStartedAt: new Date(),
        },
      ]),
      gameToken: { secret: SECRET, ttlSeconds: 900 },
    });
    const access = await service.getAccess(buyer, ROOM_ID);
    expect(access).toEqual({ owned: true, playable: false });
  });

  it("una compra pending no cuenta como acceso", async () => {
    const service = createRoomAccessService({
      store: createInMemoryRoomAccessStore([
        {
          userId: buyer.userId,
          roomId: ROOM_ID,
          purchaseId: "purchase-1",
          roomVersionId: ROOM_VERSION_ID,
          status: "pending",
          playSessionStartedAt: null,
        },
      ]),
      gameToken: { secret: SECRET, ttlSeconds: 900 },
    });
    expect(await service.getAccess(buyer, ROOM_ID)).toEqual({ owned: false, playable: false });
  });
});
