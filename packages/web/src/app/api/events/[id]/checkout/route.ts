import { publicOrigin } from "@/server/mcp-oauth";
import { resolveActorFromRequest } from "@/server/context";
import { createEventHandlers, type EventRouteContext } from "@/server/rest/events";
import { getEventService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/events/:id/checkout — pago por el total (si no es autoventa). La
 * pasarela real (Stripe) es del ticket 5.1.
 */
export function POST(request: Request, ctx: EventRouteContext) {
  const origin = publicOrigin(request.url);
  return createEventHandlers({
    events: getEventService(),
    resolveActor: resolveActorFromRequest,
    // B-21: URL absoluta construida desde el origen real de la petición (nunca
    // `NEXT_PUBLIC_APP_URL`, que Stripe rechaza si queda vacía/relativa).
    buildUrls: (eventId) => ({
      successUrl: `${origin}/es/checkout/confirmation?type=event_credits&status=success&eventId=${eventId}`,
      cancelUrl: `${origin}/es/checkout/confirmation?type=event_credits&status=cancelled&eventId=${eventId}`,
    }),
  }).postCheckout(request, ctx);
}
