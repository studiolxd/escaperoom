import { resolveActorFromRequest } from "@/server/context";
import { createEventHandlers, type EventRouteContext } from "@/server/rest/events";
import { getEventService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = () =>
  createEventHandlers({
    events: getEventService(),
    resolveActor: resolveActorFromRequest,
    // Sin checkout en estos endpoints: nunca se invoca, pero el tipo lo exige.
    buildUrls: () => ({ successUrl: "", cancelUrl: "" }),
  });

/** GET /api/events/:id — detalle + resumen (nº sesiones, claves por estado). Organizador o admin. */
export function GET(request: Request, ctx: EventRouteContext) {
  return handlers().getEvent(request, ctx);
}

/** PATCH /api/events/:id — edita la configuración mientras `status = draft`. Organizador. */
export function PATCH(request: Request, ctx: EventRouteContext) {
  return handlers().patchEvent(request, ctx);
}
