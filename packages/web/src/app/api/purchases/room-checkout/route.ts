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
    // La pasarela no conoce el idioma del comprador (no viaja en `PaymentGateway`):
    // igual que el resto de la superficie REST de compras, la confirmación se
    // sirve siempre en `es` (`DEFAULT_LOCALE`); el selector de idioma de la
    // propia página permite cambiarlo.
    // B-21: `roomId` (para que la confirmación pueda enlazar la sala) y
    // `purchaseId` (para que pueda consultar el estado real de la compra).
    buildUrls: ({ purchaseId, roomId }) => ({
      successUrl: `${origin}/es/checkout/confirmation?type=room&status=success&roomId=${roomId}&purchaseId=${purchaseId}`,
      cancelUrl: `${origin}/es/checkout/confirmation?type=room&status=cancelled&roomId=${roomId}`,
    }),
  }).postRoomCheckout(request);
}
