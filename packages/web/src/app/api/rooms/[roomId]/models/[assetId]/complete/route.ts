import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import {
  createRoomModelsHandlers,
  type RoomModelsAssetRouteContext,
} from "@/server/rest/room-models";
import { getIntroMediaService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:roomId/models/:assetId/complete → `ModelUploadResult`:
 * lee el GLB subido por el PUT presignado, lo valida y mide (triángulos,
 * texturas, extensiones, envolvente) y lo deja listo; si no vale, lo borra.
 * Cuota `intro-media-complete`.
 */
export const POST = withRateLimit(
  "intro-media-complete",
  (request: Request, ctx: RoomModelsAssetRouteContext) =>
    createRoomModelsHandlers({
      introMedia: getIntroMediaService(),
      resolveActor: resolveActorFromRequest,
    }).postComplete(request, ctx),
);
