import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createInvitationHandlers } from "@/server/rest/access-keys";
import type { EventRouteContext } from "@/server/rest/events";
import { getInvitationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/events/:id/invitations/resend — recordatorio a todas las claves
 * pendientes de confirmar (202, lo entrega el worker). Organizador.
 */
export const POST = withRateLimit(
  "invitation-resend-pending",
  (request: Request, ctx: EventRouteContext) =>
    createInvitationHandlers({
      invitations: getInvitationService(),
      resolveActor: resolveActorFromRequest,
    }).postResendPending(request, ctx),
);
