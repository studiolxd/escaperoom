import { resolveActorFromRequest } from "@/server/context";
import { createAudioHandlers, type AudioUploadRouteContext } from "@/server/rest/audio";
import { getAudioAssetService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/audio/uploads/:id — metadatos y URL de escucha firmada (dueño o moderador). */
export function GET(request: Request, ctx: AudioUploadRouteContext) {
  return createAudioHandlers({
    audio: getAudioAssetService(),
    resolveActor: resolveActorFromRequest,
  }).getUpload(request, ctx);
}
