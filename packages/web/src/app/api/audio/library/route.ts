import { resolveActorFromRequest } from "@/server/context";
import { createAudioHandlers } from "@/server/rest/audio";
import { getAudioAssetService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = () =>
  createAudioHandlers({ audio: getAudioAssetService(), resolveActor: resolveActorFromRequest });

/** GET /api/audio/library — biblioteca de audio incluida (specs/15 §1). */
export function GET(request: Request) {
  return handlers().listLibrary(request);
}
