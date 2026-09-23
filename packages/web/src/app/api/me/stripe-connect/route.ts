import { publicOrigin } from "@/server/mcp-oauth";
import { resolveActorFromRequest } from "@/server/context";
import { createCreatorConnectHandlers } from "@/server/rest/creator-connect";
import { getCreatorConnectService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/me/stripe-connect — crea la cuenta Express `recipient` del
 * creador si hace falta y devuelve la URL hospedada de onboarding de Stripe
 * (specs/13 §2, specs/02 §2).
 */
export function POST(request: Request) {
  const origin = publicOrigin(request.url);
  return createCreatorConnectHandlers({
    connect: getCreatorConnectService(),
    resolveActor: resolveActorFromRequest,
    // Placeholder mínimo: no hay página de cobros del creador en esta
    // iteración (fuera de alcance, ver PR), así que se vuelve al panel.
    buildUrls: () => ({
      refreshUrl: `${origin}/es/creator?onboarding=refresh`,
      returnUrl: `${origin}/es/creator?onboarding=return`,
    }),
  }).postStripeConnect(request);
}
