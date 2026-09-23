import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import {
  createModerationHandlers,
  type ModerationRoomRouteContext,
} from "@/server/rest/moderation";
import { getModerationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/rooms/:roomId/report — crea un `contentReport` (`REPORT_REASON_REQUIRED` sin motivo). */
export const POST = withRateLimit(
  "report-write",
  (request: Request, ctx: ModerationRoomRouteContext) =>
    createModerationHandlers({
      moderation: getModerationService(),
      resolveActor: resolveActorFromRequest,
    }).postRoomReport(request, ctx),
);
