import { isUuid, type FreeRoomAccessService } from "@escaperoom/shared/services";
import { NO_STORE } from "./_http";

/** Dependencias inyectables del handler de sala gratis (testeable sin Postgres). */
export type FreeRoomAccessHandlerDeps = {
  /** `null` si falta `GAME_ACCESS_TOKEN_SECRET` en producción (ruta desactivada). */
  freeRoomAccess: FreeRoomAccessService | null;
};

export type FreeRoomAccessRouteContext = { params: Promise<{ roomId: string }> };

/**
 * `GET /api/rooms/:roomId/free-access` (punto i de "CTA Jugar",
 * `docs/DEUDA.md`): sin sesión. `{ eligible: false }` si la sala no es
 * realmente gratis (precio distinto de 0, o sin venta individual); con
 * `eligible: true`, el `gameToken` `kind: "free"` que exige la `GameRoom`.
 * Rate-limitada por IP en la ruta (`withRateLimit("free-room-play")`).
 */
export function createFreeRoomAccessHandlers(deps: FreeRoomAccessHandlerDeps) {
  return {
    async getFreeAccess(_request: Request, ctx: FreeRoomAccessRouteContext): Promise<Response> {
      const { roomId } = await ctx.params;
      if (!deps.freeRoomAccess) {
        return Response.json(
          { error: { code: "GAME_UNAVAILABLE", message: "Partidas no disponibles" } },
          { status: 503, headers: NO_STORE },
        );
      }
      if (!isUuid(roomId)) {
        return Response.json({ eligible: false }, { headers: NO_STORE });
      }
      const access = await deps.freeRoomAccess.getFreeAccess(roomId);
      return Response.json(access, { headers: NO_STORE });
    },
  };
}
