import { resolveActorFromRequest } from "@/server/context";
import { createEventHandlers } from "@/server/rest/events";
import { getEventService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/me/events — eventos propios como organizador, paginados por cursor (specs/13 §2). */
export function GET(request: Request) {
  return createEventHandlers({
    events: getEventService(),
    resolveActor: resolveActorFromRequest,
  }).listMyEvents(request);
}
