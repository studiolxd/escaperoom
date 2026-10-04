import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createRoomModelsHandlers, type RoomModelsRouteContext } from "@/server/rest/room-models";
import { getIntroMediaService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:roomId/models — `{ filename, contentType, byteSize }` →
 * 201 `{ assetId, uploadUrl, headers }`: reserva un modelo GLB de la sala y
 * firma un PUT directo al bucket (hasta 15 MB). Solo el autor. Cuota
 * `intro-media-upload`.
 */
export const POST = withRateLimit(
  "intro-media-upload",
  (request: Request, ctx: RoomModelsRouteContext) =>
    createRoomModelsHandlers({
      introMedia: getIntroMediaService(),
      resolveActor: resolveActorFromRequest,
    }).post(request, ctx),
);
