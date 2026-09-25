import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createRoomCoverHandlers, type RoomCoverRouteContext } from "@/server/rest/room-cover";
import { getRoomCoverService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:roomId/cover-image — el autor sube la imagen de portada de
 * su sala (`multipart/form-data`, campo `file`). Ver `RoomCoverService`
 * (A-12): sniff de magic bytes, `deletedAt`, cuota y orden de escritura
 * `putObject → update → deleteObject(old)`.
 */
export const POST = withRateLimit(
  "room-cover-write",
  (request: Request, ctx: RoomCoverRouteContext) =>
    createRoomCoverHandlers({
      roomCover: getRoomCoverService(),
      resolveActor: resolveActorFromRequest,
    }).postCoverImage(request, ctx),
);
