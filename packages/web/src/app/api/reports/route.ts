import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createModerationHandlers } from "@/server/rest/moderation";
import { getModerationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/reports — reporta una sala, una reseña o un usuario (specs/17 §2). */
export const POST = withRateLimit("report-write", (request: Request) =>
  createModerationHandlers({
    moderation: getModerationService(),
    resolveActor: resolveActorFromRequest,
  }).postReport(request),
);
