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

/**
 * POST /api/audio/generate/confirm — cobra créditos y da de alta el audio
 * generado, disponible al instante sin moderación previa (ticket 4.9,
 * specs/15 §2-4, ADR-039).
 */
export function POST(request: Request) {
  return handlers().confirm(request);
}
