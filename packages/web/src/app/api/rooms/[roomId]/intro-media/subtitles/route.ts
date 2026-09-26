import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createIntroMediaHandlers, type IntroMediaRouteContext } from "@/server/rest/intro-media";
import { getIntroMediaService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:roomId/intro-media/subtitles?lang=xx — el cuerpo es el
 * `.vtt` (WebVTT UTF-8, hasta 512 KB) → 201 `{ ref }`. Solo el autor. Cuota
 * `intro-media-upload` (la misma que el vídeo).
 */
/**
 * GET /api/rooms/:roomId/intro-media/subtitles?ref=media:<uuid> — el WebVTT
 * desde el mismo origen para la vista previa del editor (`<track>` sin CORS).
 * Solo el autor. Cuota `intro-media-read`.
 */
export const GET = withRateLimit(
  "intro-media-read",
  (request: Request, ctx: IntroMediaRouteContext) =>
    createIntroMediaHandlers({
      introMedia: getIntroMediaService(),
      resolveActor: resolveActorFromRequest,
    }).getSubtitles(request, ctx),
);

export const POST = withRateLimit(
  "intro-media-upload",
  (request: Request, ctx: IntroMediaRouteContext) =>
    createIntroMediaHandlers({
      introMedia: getIntroMediaService(),
      resolveActor: resolveActorFromRequest,
    }).postSubtitles(request, ctx),
);
