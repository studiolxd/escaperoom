import { resolveActorFromRequest } from "@/server/context";
import { createAudioHandlers, type AudioUploadRouteContext } from "@/server/rest/audio";
import { getAudioAssetService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/admin/audio/:id — aprueba o rechaza (con motivo) un audio subido. */
export function PATCH(request: Request, ctx: AudioUploadRouteContext) {
  return createAudioHandlers({
    audio: getAudioAssetService(),
    resolveActor: resolveActorFromRequest,
  }).review(request, ctx);
}
