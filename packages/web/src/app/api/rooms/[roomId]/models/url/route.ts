import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createRoomModelsHandlers, type RoomModelsRouteContext } from "@/server/rest/room-models";
import { getIntroMediaService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/:roomId/models/url?ref=… → `{ url }`: URL firmada de lectura
 * de un modelo propio (`media:<uuid>` listo, o clave publicada). Solo el
 * autor. Cuota `intro-media-read`.
 */
export const GET = withRateLimit(
  "intro-media-read",
  (request: Request, ctx: RoomModelsRouteContext) =>
    createRoomModelsHandlers({
      introMedia: getIntroMediaService(),
      resolveActor: resolveActorFromRequest,
    }).getUrl(request, ctx),
);
