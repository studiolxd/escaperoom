import { resolveActorFromRequest } from "@/server/context";
import { createAccessKeyHandlers } from "@/server/rest/access-keys";
import type { EventRouteContext } from "@/server/rest/events";
import { getAccessKeyService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = () =>
  createAccessKeyHandlers({
    accessKeys: getAccessKeyService(),
    resolveActor: resolveActorFromRequest,
  });

/** GET /api/events/:id/access-keys — listado paginado con estado y asientos (organizador). */
export function GET(request: Request, ctx: EventRouteContext) {
  return handlers().listAccessKeys(request, ctx);
}

/**
 * POST /api/events/:id/access-keys — genera claves a demanda dentro de lo
 * comprado: `{ type, count?, seats?, emails?, sessionId?, groupId? }` (organizador).
 */
export function POST(request: Request, ctx: EventRouteContext) {
  return handlers().postAccessKeys(request, ctx);
}
