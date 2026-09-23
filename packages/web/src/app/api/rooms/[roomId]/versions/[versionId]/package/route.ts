import { resolveActorFromRequest } from "@/server/context";
import {
  createRoomPublishHandlers,
  type RoomVersionRouteContext,
} from "@/server/rest/room-publish";
import { getRoomPublishService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/:roomId/versions/:versionId/package — el RoomPackage
 * congelado de una versión (specs/13 §4). Solo el autor o un admin.
 */
export function GET(request: Request, ctx: RoomVersionRouteContext) {
  return createRoomPublishHandlers({
    publish: getRoomPublishService(),
    resolveActor: resolveActorFromRequest,
  }).getVersionPackage(request, ctx);
}
