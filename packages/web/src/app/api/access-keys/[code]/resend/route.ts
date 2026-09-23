import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createInvitationHandlers, type AccessKeyRouteContext } from "@/server/rest/access-keys";
import { getInvitationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/access-keys/:code/resend — reenvía el email de invitación (202, lo
 * entrega el worker). Si la clave aún no está confirmada sale como recordatorio.
 */
export const POST = withRateLimit(
  "invitation-resend",
  (request: Request, ctx: AccessKeyRouteContext) =>
    createInvitationHandlers({
      invitations: getInvitationService(),
      resolveActor: resolveActorFromRequest,
    }).postResend(request, ctx),
);
