import { resolveActorFromRequest } from "@/server/context";
import { createAudioGenerationHandlers } from "@/server/rest/audio-generation";
import { getAudioGenerationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = () =>
  createAudioGenerationHandlers({
    generation: getAudioGenerationService(),
    resolveActor: resolveActorFromRequest,
  });

/** POST /api/audio/generate/preview — sintetiza sin cobrar ni almacenar (specs/15 §3). */
export function POST(request: Request) {
  return handlers().preview(request);
}
