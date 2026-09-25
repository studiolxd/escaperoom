import { describe, expect, it } from "vitest";
import { verifyGameAccessToken } from "../src/services/game-access-token";
import { CatalogError, createFreeRoomAccessService, type CatalogRoom } from "../src/services";

/**
 * `GET /api/rooms/:roomId/free-access` (punto i de "CTA Jugar",
 * `docs/DEUDA.md`): sala realmente gratis = `priceCents: 0` +
 * `saleIndividual: true`. Precio `null` (sin venta individual, punto j) NO
 * es gratis — es "solo para eventos" o sin ningún modo de venta.
 */

const SECRET = "test-game-access-token-secret-0123456789ab";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";

function room(overrides: Partial<Pick<CatalogRoom, "priceCents" | "saleIndividual">> = {}): CatalogRoom {
  return {
    priceCents: 0,
    saleIndividual: true,
    latestVersion: { id: VERSION_ID, semver: "1.0.0", publishedAt: new Date().toISOString() },
    ...overrides,
  } as CatalogRoom;
}

function serviceWith(getRoom: (roomId: string) => Promise<CatalogRoom>) {
  return createFreeRoomAccessService({
    catalog: { getRoom: (_actor, roomId) => getRoom(roomId) },
    gameToken: { secret: SECRET, ttlSeconds: 900 },
  });
}

describe("free-room-access", () => {
  it("sala con precio 0 y venta individual: eligible con gameToken kind free", async () => {
    const service = serviceWith(async () => room());
    const result = await service.getFreeAccess(ROOM_ID);
    expect(result.eligible).toBe(true);
    if (!result.eligible) throw new Error("debería ser eligible");
    expect(result.roomVersionId).toBe(VERSION_ID);
    const verified = verifyGameAccessToken(SECRET, result.gameToken);
    expect(verified).toMatchObject({
      ok: true,
      claims: { kind: "free", roomId: ROOM_ID, roomVersionId: VERSION_ID },
    });
  });

  it("precio > 0: no eligible", async () => {
    const service = serviceWith(async () => room({ priceCents: 199 }));
    expect(await service.getFreeAccess(ROOM_ID)).toEqual({ eligible: false });
  });

  it("precio null (sin venta individual, punto j): no eligible aunque saleIndividual sea true", async () => {
    const service = serviceWith(async () => room({ priceCents: null }));
    expect(await service.getFreeAccess(ROOM_ID)).toEqual({ eligible: false });
  });

  it("precio 0 pero sin venta individual: no eligible", async () => {
    const service = serviceWith(async () => room({ saleIndividual: false }));
    expect(await service.getFreeAccess(ROOM_ID)).toEqual({ eligible: false });
  });

  it("sala inexistente (ROOM_NOT_FOUND): no eligible, no relanza", async () => {
    const service = serviceWith(async () => {
      throw new CatalogError("ROOM_NOT_FOUND", "no existe");
    });
    expect(await service.getFreeAccess(ROOM_ID)).toEqual({ eligible: false });
  });

  it("otros errores del catálogo sí se propagan", async () => {
    const service = serviceWith(async () => {
      throw new Error("postgres caído");
    });
    await expect(service.getFreeAccess(ROOM_ID)).rejects.toThrow("postgres caído");
  });
});
