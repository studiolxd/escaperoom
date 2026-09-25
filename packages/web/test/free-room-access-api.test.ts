import { createFreeRoomAccessService, verifyGameAccessToken, type CatalogRoom } from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createFreeRoomAccessHandlers } from "../src/server/rest/free-room-access";

/**
 * `GET /api/rooms/:roomId/free-access` (punto i de "CTA Jugar",
 * `docs/DEUDA.md`): el handler REST sobre el servicio de dominio, sin
 * Postgres. El rate limit por IP (`free-room-play`) se prueba en
 * `rate-limit.test.ts`, no aquí.
 */

const SECRET = "test-game-access-token-secret-0123456789ab";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";

type FreeAccessJson = { eligible: boolean; gameToken?: string; roomVersionId?: string };

function request(): Request {
  return new Request("http://localhost/api/rooms/x/free-access");
}

function room(overrides: Partial<Pick<CatalogRoom, "priceCents" | "saleIndividual">> = {}): CatalogRoom {
  return {
    priceCents: 0,
    saleIndividual: true,
    latestVersion: { id: VERSION_ID, semver: "1.0.0", publishedAt: new Date().toISOString() },
    ...overrides,
  } as CatalogRoom;
}

describe("GET /api/rooms/:roomId/free-access", () => {
  it("503 si la ruta está desactivada (sin GAME_ACCESS_TOKEN_SECRET)", async () => {
    const handlers = createFreeRoomAccessHandlers({ freeRoomAccess: null });
    const res = await handlers.getFreeAccess(request(), {
      params: Promise.resolve({ roomId: ROOM_ID }),
    });
    expect(res.status).toBe(503);
  });

  it("un roomId sin forma de UUID responde eligible:false sin tocar el servicio", async () => {
    const handlers = createFreeRoomAccessHandlers({
      freeRoomAccess: createFreeRoomAccessService({
        catalog: { getRoom: async () => room() },
        gameToken: { secret: SECRET, ttlSeconds: 900 },
      }),
    });
    const res = await handlers.getFreeAccess(request(), {
      params: Promise.resolve({ roomId: "no-es-un-uuid" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as FreeAccessJson).toEqual({ eligible: false });
  });

  it("sala gratis: 200 con gameToken válido kind free, sin exigir sesión", async () => {
    const handlers = createFreeRoomAccessHandlers({
      freeRoomAccess: createFreeRoomAccessService({
        catalog: { getRoom: async () => room() },
        gameToken: { secret: SECRET, ttlSeconds: 900 },
      }),
    });
    const res = await handlers.getFreeAccess(request(), {
      params: Promise.resolve({ roomId: ROOM_ID }),
    });
    const body = (await res.json()) as FreeAccessJson;
    expect(body.eligible).toBe(true);
    expect(body.roomVersionId).toBe(VERSION_ID);
    expect(verifyGameAccessToken(SECRET, body.gameToken).ok).toBe(true);
  });

  it("sala de pago: 200 con eligible:false", async () => {
    const handlers = createFreeRoomAccessHandlers({
      freeRoomAccess: createFreeRoomAccessService({
        catalog: { getRoom: async () => room({ priceCents: 199 }) },
        gameToken: { secret: SECRET, ttlSeconds: 900 },
      }),
    });
    const res = await handlers.getFreeAccess(request(), {
      params: Promise.resolve({ roomId: ROOM_ID }),
    });
    expect((await res.json()) as FreeAccessJson).toEqual({ eligible: false });
  });
});
