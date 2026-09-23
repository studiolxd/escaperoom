import { resolveActorFromRequest } from "@/server/context";
import { createRoomDraftHandlers, type RoomRouteContext } from "@/server/rest/room-draft";
import { getRoomDraftService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:roomId/update — append de un update Yjs binario al draft,
 * con compactación periódica en `roomSnapshot` (specs/09 §2). Solo el autor.
 */
export function POST(request: Request, ctx: RoomRouteContext) {
  return createRoomDraftHandlers({
    drafts: getRoomDraftService(),
    resolveActor: resolveActorFromRequest,
  }).postUpdate(request, ctx);
}
