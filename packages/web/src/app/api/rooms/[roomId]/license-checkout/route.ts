import { publicOrigin } from "@/server/mcp-oauth";
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
  const origin = publicOrigin(request.url);
  return createRoomLicenseHandlers({
    licenses: getRoomLicenseService(),
    resolveActor: resolveActorFromRequest,
    // B-21: URL absoluta construida desde el origen real de la petición (nunca
    // `NEXT_PUBLIC_APP_URL`, que Stripe rechaza si queda vacía/relativa).
    buildUrls: (roomId) => ({
      successUrl: `${origin}/es/checkout/confirmation?type=room_license&status=success&roomId=${roomId}`,
      cancelUrl: `${origin}/es/checkout/confirmation?type=room_license&status=cancelled&roomId=${roomId}`,
    }),
  }).postLicenseCheckout(request, ctx);
}
