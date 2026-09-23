import { resolveActorFromRequest } from "@/server/context";
import { createEventHandlers, type EventRouteContext } from "@/server/rest/events";
import { getEventService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/events/:id/activate — `draft → active` cuando el pago está saldado
 * (autoventa o ya pagado). Organizador; el webhook de 5.1 usará el servicio.
 */
export function POST(request: Request, ctx: EventRouteContext) {
  return createEventHandlers({
    events: getEventService(),
    resolveActor: resolveActorFromRequest,
  }).postActivate(request, ctx);
}
