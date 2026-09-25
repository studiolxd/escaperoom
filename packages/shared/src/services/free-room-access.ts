import { ANONYMOUS_ACTOR } from "./actor";
import { CatalogError, type CatalogService } from "./catalog";
import { signGameAccessToken } from "./game-access-token";

/**
 * `GET /api/rooms/:roomId/free-access` (punto i de "CTA Jugar",
 * `docs/DEUDA.md`, decidido 2026-09-25): una sala realmente gratis
 * (`priceCents === 0` y `saleIndividual: true`) se juega SIN cuenta y sin
 * `purchase`/Stripe. A diferencia de `room-access.ts`, no hay nada que
 * reclamar ni consumir — cualquiera puede pedir un `gameToken` `kind: "free"`
 * tantas veces como quiera; el único freno contra abuso es la cuota por IP
 * (`withRateLimit("free-room-play")`) al EMITIR el token, no la `GameRoom`.
 *
 * Precio `null` (sin venta individual) NO es gratis (punto j): esa sala es
 * "solo para eventos" o sin ningún modo de venta, y este servicio la rechaza
 * igual que una sala de pago.
 */
export type FreeRoomAccessResult =
  | { eligible: true; gameToken: string; roomVersionId: string }
  | { eligible: false };

export function createFreeRoomAccessService(deps: {
  catalog: Pick<CatalogService, "getRoom">;
  gameToken: { secret: string; ttlSeconds: number };
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  return {
    async getFreeAccess(roomId: string): Promise<FreeRoomAccessResult> {
      const room = await deps.catalog.getRoom(ANONYMOUS_ACTOR, roomId).catch((err: unknown) => {
        if (err instanceof CatalogError && err.code === "ROOM_NOT_FOUND") return null;
        throw err;
      });
      if (!room || room.priceCents !== 0 || !room.saleIndividual) {
        return { eligible: false };
      }
      const roomVersionId = room.latestVersion.id;
      const issuedAt = now().getTime();
      const gameToken = signGameAccessToken(
        deps.gameToken.secret,
        { kind: "free", roomId, roomVersionId },
        { now: issuedAt, expiresAt: issuedAt + deps.gameToken.ttlSeconds * 1000 },
      );
      return { eligible: true, gameToken, roomVersionId };
    },
  };
}

export type FreeRoomAccessService = ReturnType<typeof createFreeRoomAccessService>;
