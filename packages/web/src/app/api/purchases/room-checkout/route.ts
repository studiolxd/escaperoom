import { publicOrigin } from "@/server/mcp-oauth";
import { resolveActorFromRequest } from "@/server/context";
import { createPurchaseHandlers } from "@/server/rest/purchases";
import { getPurchaseService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/purchases/room-checkout — `{ roomVersionId }` → valida
 * `saleIndividual` y precio, crea la `purchase` `pending` y abre el Checkout
 * de Stripe (specs/13 §5). `200 { purchase, checkoutUrl }`.
 */
export function POST(request: Request) {
  const origin = publicOrigin(request.url);
  return createPurchaseHandlers({
    purchases: getPurchaseService(),
    resolveActor: resolveActorFromRequest,
    // Placeholder mínimo: no hay página de confirmación de compra en esta
    // iteración (fuera de alcance, ver PR), así que se vuelve al catálogo.
    buildUrls: () => ({
      successUrl: `${origin}/es/rooms?checkout=success`,
      cancelUrl: `${origin}/es/rooms?checkout=cancelled`,
    }),
  }).postRoomCheckout(request);
}
