import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createEventPanelHandlers, type EventPanelRouteContext } from "@/server/rest/event-panel";
import { getEventPanelService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/events/:id/start-all — "Comenzar todos"/"Comenzar igualmente"
 * (ticket "inicio conjunto"): solo el organizador, y solo con la opción
 * activa en el evento. Cuerpo opcional `{force}`.
 */
export const POST = withRateLimit(
  "event-start-all",
  (request: Request, ctx: EventPanelRouteContext) =>
    createEventPanelHandlers({
      panel: getEventPanelService(),
      resolveActor: resolveActorFromRequest,
    }).postStartAll(request, ctx),
);
