import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createIntroMediaHandlers, type IntroMediaRouteContext } from "@/server/rest/intro-media";
import { getIntroMediaService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:roomId/intro-media/video — `{ filename, contentType,
 * byteSize }` → 201 `{ assetId, uploadUrl, headers }`: reserva el vídeo de la
 * introducción y firma un PUT directo al bucket (el fichero, hasta 200 MB, no
 * pasa por el servidor). Solo el autor. Cuota `intro-media-upload`.
 */
export const POST = withRateLimit(
  "intro-media-upload",
  (request: Request, ctx: IntroMediaRouteContext) =>
    createIntroMediaHandlers({
      introMedia: getIntroMediaService(),
      resolveActor: resolveActorFromRequest,
    }).postVideo(request, ctx),
);
