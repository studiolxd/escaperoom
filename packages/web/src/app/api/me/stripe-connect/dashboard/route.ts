import { resolveActorFromRequest } from "@/server/context";
import { createCreatorConnectHandlers } from "@/server/rest/creator-connect";
import { getCreatorConnectService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me/stripe-connect/dashboard — enlace de un solo uso al dashboard
 * Express de Stripe del creador, solo si el onboarding ya está completo
 * (specs/02 §2). `409 ONBOARDING_NOT_COMPLETE` si no.
 */
export function GET(request: Request) {
  return createCreatorConnectHandlers({
    connect: getCreatorConnectService(),
    resolveActor: resolveActorFromRequest,
    buildUrls: () => ({ refreshUrl: "", returnUrl: "" }),
  }).getStripeConnectDashboard(request);
}
