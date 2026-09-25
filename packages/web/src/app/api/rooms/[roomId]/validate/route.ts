import { loadAssetManifestFor } from "@/server/asset-manifest";
import { resolveActorFromRequest } from "@/server/context";
import type { RoomRouteContext } from "@/server/rest/room-draft";
import { createRoomValidateHandlers } from "@/server/rest/room-validate";
import { getDraftSerializer, getRoomDraftService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:roomId/validate — valida el draft del editor (specs/09 §5,
 * specs/22 §2) con el mismo validador que el editor y `publish()`. Solo el
 * autor.
 */
export function POST(request: Request, ctx: RoomRouteContext) {
  return createRoomValidateHandlers({
    drafts: getRoomDraftService(),
    resolveActor: resolveActorFromRequest,
    serialize: getDraftSerializer(),
    loadAssetManifest: loadAssetManifestFor,
  }).postValidate(request, ctx);
}
