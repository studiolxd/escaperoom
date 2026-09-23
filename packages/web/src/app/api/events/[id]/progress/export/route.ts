import { resolveActorFromRequest } from "@/server/context";
import { createEventPanelHandlers, type EventPanelRouteContext } from "@/server/rest/event-panel";
import { getEventPanelService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/events/:id/progress/export?locale= — progreso y ranking en CSV. Organizador. */
export function GET(request: Request, ctx: EventPanelRouteContext) {
  return createEventPanelHandlers({
    panel: getEventPanelService(),
    resolveActor: resolveActorFromRequest,
  }).getProgressCsv(request, ctx);
}
