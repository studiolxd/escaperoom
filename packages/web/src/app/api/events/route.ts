import { resolveActorFromRequest } from "@/server/context";
import { createEventHandlers } from "@/server/rest/events";
import { getEventService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/events — crea un evento sobre una `roomVersion` publicada: valida
 * `saleEvents`, congela `pricingSnapshot` y calcula el total (specs/13 §6.1).
 * Autoventa del autor: gratis y activable sin checkout.
 */
export function POST(request: Request) {
  return createEventHandlers({
    events: getEventService(),
    resolveActor: resolveActorFromRequest,
  }).createEvent(request);
}
