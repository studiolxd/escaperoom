import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import {
  createIntroMediaHandlers,
  type IntroMediaAssetRouteContext,
} from "@/server/rest/intro-media";
import { getIntroMediaService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:roomId/intro-media/video/:assetId/complete → `{ ref }`
 * (`media:<uuid>`): comprueba el objeto subido por el PUT presignado (tamaño
 * con HEAD, magic bytes mp4/webm con un GET por rango) y lo deja listo; si no
 * cuadra, lo borra. Cuota `intro-media-complete`.
 */
export const POST = withRateLimit(
  "intro-media-complete",
  (request: Request, ctx: IntroMediaAssetRouteContext) =>
    createIntroMediaHandlers({
      introMedia: getIntroMediaService(),
      resolveActor: resolveActorFromRequest,
    }).postVideoComplete(request, ctx),
);
