import {
  RoomLicenseError,
  type Actor,
  type ForkResult,
  type LicensePurchaseRow,
  type RoomLicenseErrorCode,
  type RoomLicenseService,
} from "@escaperoom/shared/services";

/** Dependencias inyectables de los handlers de licencias (testeables sin Postgres ni Stripe). */
export type RoomLicenseHandlerDeps = {
  licenses: RoomLicenseService;
  resolveActor: (request: Request) => Promise<Actor>;
};

export type RoomRouteContext = { params: Promise<{ roomId: string }> };

const STATUS_BY_CODE: Record<RoomLicenseErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  RECIPIENT_NOT_FOUND: 404,
  INVALID_RECIPIENT: 422,
  LICENSE_NOT_AVAILABLE: 422,
  ROOM_VERSION_UNAVAILABLE: 422,
  LICENSE_OWN_ROOM: 409,
  LICENSE_ALREADY_OWNED: 409,
  PURCHASE_NOT_PENDING: 409,
  PAYMENT_GATEWAY_UNAVAILABLE: 501,
};

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(code: string, message: string, status: number, extra = {}): Response {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: NO_STORE });
}

/** Cuerpo JSON en una clase aparte para distinguir 400 (JSON roto) de 422 (datos). */
class BadJsonError extends Error {}

/** Cuerpo JSON; vacío = `{}` (el de `license-checkout` es opcional). */
async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BadJsonError("El cuerpo no es JSON válido");
  }
}

/** Traduce errores de dominio a la forma de error REST (specs/13 §1). */
async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RoomLicenseError) {
      const extra = {
        ...(err.issues.length > 0 ? { issues: err.issues } : {}),
        ...(err.resultingRoomId ? { resultingRoomId: err.resultingRoomId } : {}),
      };
      return errorResponse(err.code, err.message, STATUS_BY_CODE[err.code], extra);
    }
    if (err instanceof BadJsonError) return errorResponse("BAD_REQUEST", err.message, 400);
    throw err;
  }
}

function purchaseJson(p: LicensePurchaseRow) {
  return {
    id: p.id,
    purchaseType: "room_license" as const,
    roomVersionId: p.roomVersionId,
    resultingRoomId: p.resultingRoomId,
    amountCents: p.amountCents,
    currency: p.currency,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  };
}

/** La sala nueva del fork (el linaje se expone solo a su dueño y al autor que regala). */
function forkJson({ room, purchase }: ForkResult) {
  return {
    purchase: purchaseJson(purchase),
    room: {
      id: room.id,
      title: room.title,
      status: room.status,
      forkedFromRoomId: room.forkedFromRoomId,
      forkedFromVersionId: room.forkedFromVersionId,
      createdAt: room.createdAt.toISOString(),
    },
  };
}

/**
 * Handlers REST de licencias entre creadores (specs/13 §4). Adaptadores finos
 * sobre `RoomLicenseService`: autorización, reglas y fork viven en el servicio.
 */
export function createRoomLicenseHandlers(deps: RoomLicenseHandlerDeps) {
  return {
    /**
     * `POST /api/rooms/:roomId/license-checkout` — `{ roomVersionId? }`. Con
     * precio: 200 `{ purchase, checkoutUrl }` (el fork llega al confirmarse el
     * pago). Licencia gratuita: 201 `{ purchase, room }`.
     */
    async postLicenseCheckout(request: Request, ctx: RoomRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        // La autorización va antes que el cuerpo: un anónimo recibe 401, no 400.
        deps.licenses.authorize(actor);
        const result = await deps.licenses.startLicenseCheckout(
          actor,
          roomId,
          await readJson(request),
        );
        if (result.status === "pending") {
          return Response.json(
            { purchase: purchaseJson(result.purchase), checkoutUrl: result.checkoutUrl },
            { headers: NO_STORE },
          );
        }
        return Response.json(forkJson(result), { status: 201, headers: NO_STORE });
      });
    },

    /** `POST /api/rooms/:roomId/gift-copy` — `{ recipientEmail, roomVersionId? }` → 201 `{ purchase, room }`. */
    async postGiftCopy(request: Request, ctx: RoomRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        deps.licenses.authorize(actor);
        const result = await deps.licenses.giftCopy(actor, roomId, await readJson(request));
        return Response.json(forkJson(result), { status: 201, headers: NO_STORE });
      });
    },
  };
}
