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
export const POST = withRateLimit(
  "intro-media-upload",
  (request: Request, ctx: IntroMediaRouteContext) =>
    createIntroMediaHandlers({
      introMedia: getIntroMediaService(),
      resolveActor: resolveActorFromRequest,
    }).postSubtitles(request, ctx),
);
