import { resolveActorFromRequest } from "@/server/context";
import { createAudioHandlers } from "@/server/rest/audio";
import { getAudioAssetService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/audio — cola de moderación de audio subido. `isModerator | isAdmin`. */
export function GET(request: Request) {
  return createAudioHandlers({
    audio: getAudioAssetService(),
    resolveActor: resolveActorFromRequest,
  }).listModerationQueue(request);
}
