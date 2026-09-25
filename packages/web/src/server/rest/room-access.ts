import type { Actor, RoomAccessService } from "@escaperoom/shared/services";

/** Dependencias inyectables del handler de acceso (testeable sin Postgres). */
export type RoomAccessHandlerDeps = {
  /** `null` si falta `GAME_ACCESS_TOKEN_SECRET` en producción (ruta desactivada). */
  roomAccess: RoomAccessService | null;
  resolveActor: (request: Request) => Promise<Actor>;
};

export type RoomAccessRouteContext = { params: Promise<{ roomId: string }> };

const NO_STORE = { "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `GET /api/rooms/:roomId/access` (specs/13, B-4): `{ owned, playable }`, y
 * con `playable: true` el `gameToken` (C-4) que `GameRoom` exige para
 * crear/unirse a la partida. Sin sesión, o sin `roomId` con forma de UUID,
 * responde como si no la tuviera (nunca revela si una compra ajena existe).
 */
export function createRoomAccessHandlers(deps: RoomAccessHandlerDeps) {
  return {
    async getAccess(request: Request, ctx: RoomAccessRouteContext): Promise<Response> {
      const { roomId } = await ctx.params;
      if (!deps.roomAccess) {
        return Response.json(
          { error: { code: "GAME_UNAVAILABLE", message: "Partidas no disponibles" } },
          { status: 503, headers: NO_STORE },
        );
      }
      if (!UUID_RE.test(roomId)) {
        return Response.json({ owned: false, playable: false }, { headers: NO_STORE });
      }
      const actor = await deps.resolveActor(request);
      const access = await deps.roomAccess.getAccess(actor, roomId);
      return Response.json(access, { headers: NO_STORE });
    },
  };
}
