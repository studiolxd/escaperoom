import { resolveActorFromRequest } from "@/server/context";
import { createModerationHandlers } from "@/server/rest/moderation";
import { getModerationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/appeals — cola de apelaciones (pendientes por defecto). `isModerator | isAdmin`. */
export function GET(request: Request) {
  return createModerationHandlers({
    moderation: getModerationService(),
    resolveActor: resolveActorFromRequest,
  }).listAppeals(request);
}
