import { resolveActorFromRequest } from "@/server/context";
import { createRoomPublishHandlers, type RoomRouteContext } from "@/server/rest/room-publish";
import { getRoomPublishService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:roomId/publish — `{ semver?, changelog? }`. Repite el
 * validador en servidor, empaqueta los assets y congela una `roomVersion`
 * inmutable (specs/13 §4, specs/08 §5). Solo el autor.
 */
export function POST(request: Request, ctx: RoomRouteContext) {
  return createRoomPublishHandlers({
    publish: getRoomPublishService(),
    resolveActor: resolveActorFromRequest,
  }).postPublish(request, ctx);
}
