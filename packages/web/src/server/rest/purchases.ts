import {
  PurchaseError,
  type Actor,
  type PurchaseErrorCode,
  type PurchaseService,
  type RoomPurchaseRow,
} from "@escaperoom/shared/services";

/** Dependencias inyectables de los handlers de compras (testeables sin Postgres ni Stripe). */
export type PurchaseHandlerDeps = {
  purchases: PurchaseService;
  resolveActor: (request: Request) => Promise<Actor>;
  /** URLs de retorno del Checkout, construidas por el adaptador (origen de la petición). */
  buildUrls: (roomVersionId: string) => { successUrl: string; cancelUrl: string };
};

export type PurchaseRouteContext = { params: Promise<{ id: string }> };

const STATUS_BY_CODE: Record<PurchaseErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  ROOM_VERSION_UNAVAILABLE: 422,
  SALE_INDIVIDUAL_DISABLED: 422,
  ALREADY_OWNED: 409,
  PURCHASE_NOT_PENDING: 409,
  PAYMENT_GATEWAY_UNAVAILABLE: 501,
};

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(code: string, message: string, status: number, extra = {}): Response {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: NO_STORE });
}

class BadJsonError extends Error {}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BadJsonError("El cuerpo no es JSON válido");
  }
}

/** Traduce errores de dominio a la forma de error REST (specs/13 §1). */
async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PurchaseError) {
      const extra = err.issues.length > 0 ? { issues: err.issues } : {};
      return errorResponse(err.code, err.message, STATUS_BY_CODE[err.code], extra);
    }
    if (err instanceof BadJsonError) return errorResponse("BAD_REQUEST", err.message, 400);
    throw err;
  }
}

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
        const body = (await readJson(request)) as { roomVersionId?: unknown };
        const roomVersionId = typeof body?.roomVersionId === "string" ? body.roomVersionId : "";
        const { purchase, checkoutUrl } = await deps.purchases.startRoomCheckout(
          actor,
          body,
          deps.buildUrls(roomVersionId),
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
