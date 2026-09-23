import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createModerationHandlers } from "@/server/rest/moderation";
import { getModerationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/me/appeal — apela la suspensión o el ban de la propia cuenta. */
export const POST = withRateLimit("appeal-write", (request: Request) =>
  createModerationHandlers({
    moderation: getModerationService(),
    resolveActor: resolveActorFromRequest,
  }).postAccountAppeal(request),
);
