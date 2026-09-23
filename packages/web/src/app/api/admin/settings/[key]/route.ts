import { resolveActorFromRequest } from "@/server/context";
import { createAdminHandlers, type SettingRouteContext } from "@/server/rest/admin";
import { getPlatformSettingsService, getPricingTierService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = () =>
  createAdminHandlers({
    settings: getPlatformSettingsService(),
    pricing: getPricingTierService(),
    resolveActor: resolveActorFromRequest,
  });

/** GET /api/admin/settings/:key — ajuste de plataforma (specs/13 §10). Solo `isAdmin`. */
export function GET(request: Request, ctx: SettingRouteContext) {
  return handlers().getSetting(request, ctx);
}

/** PATCH /api/admin/settings/:key — `{ value }` validado con el esquema de la clave. */
export function PATCH(request: Request, ctx: SettingRouteContext) {
  return handlers().patchSetting(request, ctx);
}
