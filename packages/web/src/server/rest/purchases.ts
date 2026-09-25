import {
  PurchaseError,
  type Actor,
  type PurchaseErrorCode,
  type PurchaseService,
  type RoomPurchaseRow,
} from "@escaperoom/shared/services";
import { handleDomainErrors, NO_STORE, readJson } from "./_http";

/** Dependencias inyectables de los handlers de compras (testeables sin Postgres ni Stripe). */
export type PurchaseHandlerDeps = {
  purchases: PurchaseService;
  resolveActor: (request: Request) => Promise<Actor>;
  /** URLs de retorno del Checkout (B-21): el servicio las construye una vez conoce `purchaseId`/`roomId`. */
  buildUrls: (ctx: { purchaseId: string; roomId: string }) => { successUrl: string; cancelUrl: string };
};

export type PurchaseRouteContext = { params: Promise<{ id: string }> };

const STATUS_BY_CODE: Record<PurchaseErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  ROOM_VERSION_UNAVAILABLE: 422,
  SALE_INDIVIDUAL_DISABLED: 422,
  PURCHASE_OWN_ROOM: 422,
  ALREADY_OWNED: 409,
  PURCHASE_NOT_PENDING: 409,
  PAYMENT_GATEWAY_UNAVAILABLE: 501,
};

/** Traduce errores de dominio a la forma de error REST (specs/13 §1). */
const handle = handleDomainErrors(PurchaseError, STATUS_BY_CODE);

export function purchaseJson(p: RoomPurchaseRow) {
  return {
    id: p.id,
    purchaseType: "room" as const,
    roomVersionId: p.roomVersionId,
    amountCents: p.amountCents,
    currency: p.currency,
    platformFeeCents: p.platformFeeCents,
    creatorShareCents: p.creatorShareCents,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  };
}

/**
 * Handlers REST de compras individuales (specs/13 §5). Adaptadores finos
 * sobre `PurchaseService`: autorización y reglas viven en el servicio.
 */
export function createPurchaseHandlers(deps: PurchaseHandlerDeps) {
  return {
    /** `POST /api/purchases/room-checkout` — `{ roomVersionId }` → 200 `{ purchase, checkoutUrl }`. */
    async postRoomCheckout(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        // La autorización va antes que el cuerpo: un anónimo recibe 401, no 400.
        deps.purchases.authorize(actor);
        const body = await readJson(request);
        const { purchase, checkoutUrl } = await deps.purchases.startRoomCheckout(
          actor,
          body,
          deps.buildUrls,
        );
        return Response.json(
          { purchase: purchaseJson(purchase), checkoutUrl },
          { headers: NO_STORE },
        );
      });
    },

    /** `GET /api/purchases/:id` — estado de una compra (comprador o admin). */
    async getPurchase(request: Request, ctx: PurchaseRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const purchase = await deps.purchases.getPurchase(actor, id);
        return Response.json(purchaseJson(purchase), { headers: NO_STORE });
      });
    },
  };
}
