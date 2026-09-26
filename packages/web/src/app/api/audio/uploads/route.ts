import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createAudioHandlers } from "@/server/rest/audio";
import { getAudioAssetService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = () =>
  createAudioHandlers({ audio: getAudioAssetService(), resolveActor: resolveActorFromRequest });

/** GET /api/audio/uploads — subidas propias con su estado de moderación. */
export function GET(request: Request) {
  return handlers().listMyUploads(request);
}

/**
 * POST /api/audio/uploads — sube un MP3 propio; queda pendiente de moderación
 * (specs/17 §1). Cuota `audio-upload` (hueco encontrado al revisar la PR #168,
 * D-12: no tenía; comparte cupo con la meta-tool `upload` del MCP).
 */
export const POST = withRateLimit("audio-upload", (request: Request) => handlers().upload(request));
