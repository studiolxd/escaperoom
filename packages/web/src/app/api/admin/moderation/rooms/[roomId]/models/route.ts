import { prisma } from "@escaperoom/shared/db";
import { resolveActorFromRequest } from "@/server/context";
import {
  createModerationModelsHandlers,
  createPrismaLatestPublishedPackage,
  type ModerationModelsRouteContext,
} from "@/server/rest/moderation-models";
import { getIntroMediaService, getModerationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/moderation/rooms/:roomId/models — modelos propios de la última versión
 * publicada de una sala, con URL firmada (1 h) y medidas. `isModerator | isAdmin`.
 */
export function GET(request: Request, ctx: ModerationModelsRouteContext) {
  return createModerationModelsHandlers({
    moderation: getModerationService(),
    introMedia: getIntroMediaService(),
    resolveActor: resolveActorFromRequest,
    loadLatestPublishedPackage: createPrismaLatestPublishedPackage(prisma),
  }).listRoomModels(request, ctx);
}
