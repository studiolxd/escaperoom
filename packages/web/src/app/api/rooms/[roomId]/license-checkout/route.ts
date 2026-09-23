import { resolveActorFromRequest } from "@/server/context";
import { createRoomLicenseHandlers, type RoomRouteContext } from "@/server/rest/room-license";
import { getRoomLicenseService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:roomId/license-checkout — un creador compra la licencia de
 * la sala de otro (specs/13 §4, specs/02 §5). La pasarela real (Stripe) es del
 * ticket 5.1: hasta entonces una licencia con precio responde 501; a precio 0
 * el fork es inmediato.
 */
export function POST(request: Request, ctx: RoomRouteContext) {
  return createRoomLicenseHandlers({
    licenses: getRoomLicenseService(),
    resolveActor: resolveActorFromRequest,
  }).postLicenseCheckout(request, ctx);
}
