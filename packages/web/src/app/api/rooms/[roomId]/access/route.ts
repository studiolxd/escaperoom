import { resolveActorFromRequest } from "@/server/context";
import { createRoomAccessHandlers, type RoomAccessRouteContext } from "@/server/rest/room-access";
import { getRoomAccessService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/:roomId/access — usuario. `{ owned, playable }` (B-4,
 * specs/13); con `playable: true` incluye el `gameToken` que la `GameRoom`
 * exige en Colyseus (C-4).
 */
export function GET(request: Request, ctx: RoomAccessRouteContext) {
  return createRoomAccessHandlers({
    roomAccess: getRoomAccessService(),
    resolveActor: resolveActorFromRequest,
  }).getAccess(request, ctx);
}
