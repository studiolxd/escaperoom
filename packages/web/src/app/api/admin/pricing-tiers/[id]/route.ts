import { resolveActorFromRequest } from "@/server/context";
import { createAdminHandlers, type PricingTierRouteContext } from "@/server/rest/admin";
import { getPlatformSettingsService, getPricingTierService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/pricing-tiers/:id — cambia un tramo cerrando la fila y
 * creando su sucesora, o lo retira con `{ activeUntil }` (specs/02 §3.2).
 */
export function PATCH(request: Request, ctx: PricingTierRouteContext) {
  return createAdminHandlers({
    settings: getPlatformSettingsService(),
    pricing: getPricingTierService(),
    resolveActor: resolveActorFromRequest,
  }).patchPricingTier(request, ctx);
}
