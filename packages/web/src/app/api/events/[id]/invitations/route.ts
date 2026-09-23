import { resolveActorFromRequest } from "@/server/context";
import { createInvitationHandlers } from "@/server/rest/access-keys";
import type { EventRouteContext } from "@/server/rest/events";
import { getInvitationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/events/:id/invitations — resumen de invitaciones por email para el
 * panel: `{ requireConfirmation, invited, sent, confirmed, pending, expired }` (organizador).
 */
export function GET(request: Request, ctx: EventRouteContext) {
  return createInvitationHandlers({
    invitations: getInvitationService(),
    resolveActor: resolveActorFromRequest,
  }).getSummary(request, ctx);
}
