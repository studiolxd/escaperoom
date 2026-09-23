import { resolveActorFromRequest } from "@/server/context";
import { createRoomPublishHandlers, type RoomRouteContext } from "@/server/rest/room-publish";
import { getRoomPublishService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/:roomId/versions — histórico de versiones publicadas (solo
 * metadata: semver, changelog, packageFormat, assetsHash, publishedAt). Público.
 */
export function GET(request: Request, ctx: RoomRouteContext) {
  return createRoomPublishHandlers({
    publish: getRoomPublishService(),
    resolveActor: resolveActorFromRequest,
  }).getVersions(request, ctx);
}
