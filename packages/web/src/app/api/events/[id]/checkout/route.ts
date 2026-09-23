import { resolveActorFromRequest } from "@/server/context";
import { createEventHandlers, type EventRouteContext } from "@/server/rest/events";
import { getEventService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/events/:id/checkout — pago por el total (si no es autoventa). La
 * pasarela real (Stripe) es del ticket 5.1: hasta entonces responde 501.
 */
export function POST(request: Request, ctx: EventRouteContext) {
  return createEventHandlers({
    events: getEventService(),
    resolveActor: resolveActorFromRequest,
  }).postCheckout(request, ctx);
}
