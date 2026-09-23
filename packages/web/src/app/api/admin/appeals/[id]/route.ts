import { resolveActorFromRequest } from "@/server/context";
import { createModerationHandlers, type ModerationIdRouteContext } from "@/server/rest/moderation";
import { getModerationService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/admin/appeals/:id — resuelve una apelación: `upheld` u `overturned` (revierte). */
export function PATCH(request: Request, ctx: ModerationIdRouteContext) {
  return createModerationHandlers({
    moderation: getModerationService(),
    resolveActor: resolveActorFromRequest,
  }).patchAppeal(request, ctx);
}
