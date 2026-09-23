import { resolveActorFromRequest } from "@/server/context";
import { createModerationHandlers } from "@/server/rest/moderation";
import { getModerationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/me/moderation — strikes vigentes, suspensión o ban de la propia cuenta. */
export function GET(request: Request) {
  return createModerationHandlers({
    moderation: getModerationService(),
    resolveActor: resolveActorFromRequest,
  }).getMyStanding(request);
}
