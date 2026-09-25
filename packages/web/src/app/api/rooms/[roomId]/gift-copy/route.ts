import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createRoomLicenseHandlers, type RoomRouteContext } from "@/server/rest/room-license";
import { getRoomLicenseService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:roomId/gift-copy — `{ recipientEmail }`. El autor regala una
 * copia editable a otro creador: fork inmediato en `draft`, sin checkout
 * (specs/13 §4, specs/02 §5). Cuota "gift-copy" por remitente (B-10); la
 * cuota por destinatario vive en el handler (`consumeGiftCopyRecipientLimit`).
 */
export const POST = withRateLimit(
  "gift-copy",
  (request: Request, ctx: RoomRouteContext) =>
    createRoomLicenseHandlers({
      licenses: getRoomLicenseService(),
      resolveActor: resolveActorFromRequest,
    }).postGiftCopy(request, ctx),
);
