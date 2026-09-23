import { resolveActorFromRequest } from "@/server/context";
import { createModerationHandlers } from "@/server/rest/moderation";
import { getModerationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/reports — cola de moderación priorizada con SLA. `isModerator | isAdmin`. */
export function GET(request: Request) {
  return createModerationHandlers({
    moderation: getModerationService(),
    resolveActor: resolveActorFromRequest,
  }).listReports(request);
}
