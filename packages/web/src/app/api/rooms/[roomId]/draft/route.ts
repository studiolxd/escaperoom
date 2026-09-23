import { resolveActorFromRequest } from "@/server/context";
import { createRoomDraftHandlers, type RoomRouteContext } from "@/server/rest/room-draft";
import { getRoomDraftService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/:roomId/draft — bootstrap del editor: último snapshot +
 * updates posteriores (specs/13 §4, specs/09 §2). Solo el autor.
 */
export function GET(request: Request, ctx: RoomRouteContext) {
  return createRoomDraftHandlers({
    drafts: getRoomDraftService(),
    resolveActor: resolveActorFromRequest,
  }).getDraft(request, ctx);
}
