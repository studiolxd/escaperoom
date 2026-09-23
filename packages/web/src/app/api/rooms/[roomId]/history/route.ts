import { resolveActorFromRequest } from "@/server/context";
import { createRoomDraftHandlers, type RoomRouteContext } from "@/server/rest/room-draft";
import { getRoomDraftService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/:roomId/history — snapshots del draft, del más reciente al
 * más antiguo, para restauración (specs/09 §2). Solo el autor.
 */
export function GET(request: Request, ctx: RoomRouteContext) {
  return createRoomDraftHandlers({
    drafts: getRoomDraftService(),
    resolveActor: resolveActorFromRequest,
  }).getHistory(request, ctx);
}
