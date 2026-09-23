import { resolveActorFromRequest } from "@/server/context";
import { createAdminHandlers } from "@/server/rest/admin";
import { getPlatformSettingsService, getPricingTierService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = () =>
  createAdminHandlers({
    settings: getPlatformSettingsService(),
    pricing: getPricingTierService(),
    resolveActor: resolveActorFromRequest,
  });

/** GET /api/admin/pricing-tiers — histórico de tramos (specs/13 §10). Solo `isAdmin`. */
export function GET(request: Request) {
  return handlers().listPricingTiers(request);
}

/** POST /api/admin/pricing-tiers — tramo nuevo, sin solapes con los vigentes. */
export function POST(request: Request) {
  return handlers().createPricingTier(request);
}
