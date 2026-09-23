import { resolveActorFromRequest } from "@/server/context";
import { createInvitationHandlers, type AccessKeyRouteContext } from "@/server/rest/access-keys";
import { getInvitationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/access-keys/:code/confirm — público (enlace del email): `{ token }`
 * firmado → `pending_confirmation → confirmed`. Idempotente.
 */
export function POST(request: Request, ctx: AccessKeyRouteContext) {
  return createInvitationHandlers({
    invitations: getInvitationService(),
    resolveActor: resolveActorFromRequest,
  }).postConfirm(request, ctx);
}
