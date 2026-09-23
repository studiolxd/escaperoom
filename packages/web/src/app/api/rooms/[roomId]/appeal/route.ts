import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import {
  createModerationHandlers,
  type ModerationRoomRouteContext,
} from "@/server/rest/moderation";
import { getModerationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/rooms/:roomId/appeal — el autor apela una retirada o un bloqueo del pre-check. */
export const POST = withRateLimit(
  "appeal-write",
  (request: Request, ctx: ModerationRoomRouteContext) =>
    createModerationHandlers({
      moderation: getModerationService(),
      resolveActor: resolveActorFromRequest,
    }).postRoomAppeal(request, ctx),
);
