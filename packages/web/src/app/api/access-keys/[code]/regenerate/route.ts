import { resolveActorFromRequest } from "@/server/context";
import { createAccessKeyHandlers, type AccessKeyRouteContext } from "@/server/rest/access-keys";
import { getAccessKeyService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/access-keys/:code/regenerate — solo rotativas: la actual caduca y
 * nace otra con `regeneratedFrom` que hereda su asignación (organizador).
 */
export function POST(request: Request, ctx: AccessKeyRouteContext) {
  return createAccessKeyHandlers({
    accessKeys: getAccessKeyService(),
    resolveActor: resolveActorFromRequest,
  }).postRegenerate(request, ctx);
}
