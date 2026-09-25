import { resolveActorFromRequest } from "@/server/context";
import { createRoomLicenseHandlers, type RoomRouteContext } from "@/server/rest/room-license";
import { getRoomLicenseService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:roomId/gift-copy — `{ recipientEmail }`. El autor regala una
 * copia editable a otro creador: fork inmediato en `draft`, sin checkout
 * (specs/13 §4, specs/02 §5).
 */
export function POST(request: Request, ctx: RoomRouteContext) {
  return createRoomLicenseHandlers({
    licenses: getRoomLicenseService(),
    resolveActor: resolveActorFromRequest,
    // Sin checkout en este endpoint: nunca se invoca, pero el tipo lo exige.
    buildUrls: () => ({ successUrl: "", cancelUrl: "" }),
  }).postGiftCopy(request, ctx);
}
