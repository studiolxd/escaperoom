import { publicOrigin } from "@/server/mcp-oauth";
import { resolveActorFromRequest } from "@/server/context";
import { createPurchaseHandlers, type PurchaseRouteContext } from "@/server/rest/purchases";
import { getPurchaseService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/purchases/:id — estado de una compra (comprador o admin, specs/13 §5). */
export function GET(request: Request, ctx: PurchaseRouteContext) {
  const origin = publicOrigin(request.url);
  return createPurchaseHandlers({
    purchases: getPurchaseService(),
    resolveActor: resolveActorFromRequest,
    buildUrls: () => ({
      successUrl: `${origin}/es/rooms?checkout=success`,
      cancelUrl: `${origin}/es/rooms?checkout=cancelled`,
    }),
  }).getPurchase(request, ctx);
}
