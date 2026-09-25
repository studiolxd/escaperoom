import {
  ANONYMOUS_ACTOR,
  createInMemoryRoomAccessStore,
  createRoomAccessService,
  verifyGameAccessToken,
  type Actor,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createRoomAccessHandlers } from "../src/server/rest/room-access";

/**
 * `GET /api/rooms/:roomId/access` (B-4, auditoría 2026-09-24): el handler
 * REST sobre el servicio de dominio con un store en memoria (sin Postgres).
 */

const SECRET = "test-game-access-token-secret-0123456789ab";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ROOM_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const buyer: Actor = { userId: "compradora", organizationId: null, role: "member" };

type AccessJson = { owned: boolean; playable: boolean; gameToken?: string };

function request(): Request {
  return new Request("http://localhost/api/rooms/x/access");
}

describe("GET /api/rooms/:roomId/access", () => {
  it("503 si la ruta está desactivada (sin GAME_ACCESS_TOKEN_SECRET)", async () => {
    const handlers = createRoomAccessHandlers({
      roomAccess: null,
      resolveActor: async () => buyer,
    });
    const res = await handlers.getAccess(request(), { params: Promise.resolve({ roomId: ROOM_ID }) });
    expect(res.status).toBe(503);
  });

  it("un roomId sin forma de UUID responde owned:false sin tocar el servicio", async () => {
    const handlers = createRoomAccessHandlers({
      roomAccess: createRoomAccessService({
        store: createInMemoryRoomAccessStore([]),
        gameToken: { secret: SECRET, ttlSeconds: 900 },
      }),
      resolveActor: async () => buyer,
    });
    const res = await handlers.getAccess(request(), {
      params: Promise.resolve({ roomId: "no-es-un-uuid" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as AccessJson).toEqual({ owned: false, playable: false });
  });

  it("anónimo: owned:false, playable:false", async () => {
    const handlers = createRoomAccessHandlers({
      roomAccess: createRoomAccessService({
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
      }),
      resolveActor: async () => ANONYMOUS_ACTOR,
    });
    const res = await handlers.getAccess(request(), { params: Promise.resolve({ roomId: ROOM_ID }) });
    expect((await res.json()) as AccessJson).toEqual({ owned: false, playable: false });
  });

  it("compra succeeded sin jugar: 200 con gameToken válido", async () => {
    const handlers = createRoomAccessHandlers({
      roomAccess: createRoomAccessService({
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
      }),
      resolveActor: async () => buyer,
    });
    const res = await handlers.getAccess(request(), { params: Promise.resolve({ roomId: ROOM_ID }) });
    const body = (await res.json()) as AccessJson;
    expect(body.owned).toBe(true);
    expect(body.playable).toBe(true);
    expect(verifyGameAccessToken(SECRET, body.gameToken).ok).toBe(true);
  });
});
