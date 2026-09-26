import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createIntroMediaHandlers, type IntroMediaRouteContext } from "@/server/rest/intro-media";
import { getIntroMediaService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/:roomId/intro-media/url?ref=… → `{ url }`: URL firmada de
 * una referencia (`media:<uuid>` propio y listo, o clave publicada) para
 * previsualizar la introducción en el editor. Solo el autor.
 */
export const GET = withRateLimit(
  "intro-media-read",
  (request: Request, ctx: IntroMediaRouteContext) =>
    createIntroMediaHandlers({
      introMedia: getIntroMediaService(),
      resolveActor: resolveActorFromRequest,
    }).getUrl(request, ctx),
);
