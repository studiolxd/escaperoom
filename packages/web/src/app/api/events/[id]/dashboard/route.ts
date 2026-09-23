import { resolveActorFromRequest } from "@/server/context";
import { createEventPanelHandlers, type EventPanelRouteContext } from "@/server/rest/event-panel";
import { getEventPanelService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/events/:id/dashboard — panel del organizador en vivo (ticket 5.9):
 * estado del evento, claves, sesiones con su progreso y ranking. Organizador.
 */
export function GET(request: Request, ctx: EventPanelRouteContext) {
  return createEventPanelHandlers({
    panel: getEventPanelService(),
    resolveActor: resolveActorFromRequest,
  }).getDashboard(request, ctx);
}
