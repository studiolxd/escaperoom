import { resolveActorFromRequest } from "@/server/context";
import { createEventPanelHandlers, type EventSessionRouteContext } from "@/server/rest/event-panel";
import { getEventPanelService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/events/:id/sessions/:sessionId/spectate — token de observador de
 * solo lectura para la room de una sesión en curso (ticket 5.9). Organizador.
 */
export function POST(request: Request, ctx: EventSessionRouteContext) {
  return createEventPanelHandlers({
    panel: getEventPanelService(),
    resolveActor: resolveActorFromRequest,
  }).postSpectate(request, ctx);
}
