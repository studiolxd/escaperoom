import { resolveActorFromRequest } from "@/server/context";
import { createInvitationHandlers, type AccessKeyRouteContext } from "@/server/rest/access-keys";
import { getInvitationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/access-keys/:code/resend — reenvía el email de invitación (202, lo
 * entrega el worker). Si la clave aún no está confirmada sale como recordatorio.
 */
export function POST(request: Request, ctx: AccessKeyRouteContext) {
  return createInvitationHandlers({
    invitations: getInvitationService(),
    resolveActor: resolveActorFromRequest,
  }).postResend(request, ctx);
}
