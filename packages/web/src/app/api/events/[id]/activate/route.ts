import { resolveActorFromRequest } from "@/server/context";
import { createAccessKeyHandlers } from "@/server/rest/access-keys";
import type { EventRouteContext } from "@/server/rest/events";
import { getAccessKeyService, getInvitationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/events/:id/activate — `draft → active` cuando el pago está saldado
 * (autoventa o ya pagado), y a continuación crea las sesiones y genera las
 * claves (`{ keyPlan? }`, ticket 5.5); las que llevan email se encolan para enviar
 * (5.6). Organizador; el webhook de 5.1 usará el servicio.
 */
export function POST(request: Request, ctx: EventRouteContext) {
  return createAccessKeyHandlers({
    accessKeys: getAccessKeyService(),
    resolveActor: resolveActorFromRequest,
    invitations: getInvitationService(),
  }).postActivate(request, ctx);
}
