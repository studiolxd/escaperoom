import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createAudioGenerationHandlers } from "@/server/rest/audio-generation";
import { getAudioGenerationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = () =>
  createAudioGenerationHandlers({
    generation: getAudioGenerationService(),
    resolveActor: resolveActorFromRequest,
  });

/**
 * POST /api/audio/generate/preview — sintetiza sin cobrar ni almacenar
 * (specs/15 §3). Cuota "audio-preview" (B-7): sin cobro de créditos, sin
 * cuota era gratis e ilimitada.
 */
export const POST = withRateLimit("audio-preview", (request: Request) => handlers().preview(request));
