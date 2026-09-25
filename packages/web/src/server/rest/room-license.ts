import { tooManyRequestsResponse } from "@escaperoom/kit/rate-limit/http";
import {
  GiftCopyInput,
  RoomLicenseError,
  type Actor,
  type ForkResult,
  type LicensePurchaseRow,
  type RoomLicenseErrorCode,
  type RoomLicenseService,
} from "@escaperoom/shared/services";
import { consumeGiftCopyRecipientLimit } from "@/server/rate-limit";
import { handleDomainErrors, NO_STORE, readJson } from "./_http";

/** Dependencias inyectables de los handlers de licencias (testeables sin Postgres ni Stripe). */
export type RoomLicenseHandlerDeps = {
  licenses: RoomLicenseService;
  resolveActor: (request: Request) => Promise<Actor>;
  /** URLs de retorno del Checkout, construidas por el adaptador (origen de la petición, B-21). */
  buildUrls: (roomId: string) => { successUrl: string; cancelUrl: string };
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

/** Traduce errores de dominio a la forma de error REST (specs/13 §1). */
const handle = handleDomainErrors(RoomLicenseError, STATUS_BY_CODE);

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
          await readJson(request, { allowEmpty: true }),
          deps.buildUrls(roomId),
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

    /**
     * `POST /api/rooms/:roomId/gift-copy` — `{ recipientEmail, roomVersionId? }`.
     *
     * B-10: la respuesta es SIEMPRE 202 con el mismo mensaje genérico, exista o
     * no una cuenta con ese email — antes, `RECIPIENT_NOT_FOUND` (404) frente a
     * un 201 con los datos del fork convertía este endpoint en un oráculo para
     * averiguar qué emails tienen cuenta. Cuota por remitente (política
     * `gift-copy`, en el `route.ts`) y por destinatario
     * (`consumeGiftCopyRecipientLimit`, cuenta por email exista o no la cuenta).
     */
    async postGiftCopy(request: Request, ctx: RoomRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        deps.licenses.authorize(actor);
        const body = await readJson(request, { allowEmpty: true });

        const parsedEmail = GiftCopyInput.pick({ recipientEmail: true }).safeParse(body);
        if (parsedEmail.success) {
          const recipientQuota = await consumeGiftCopyRecipientLimit(parsedEmail.data.recipientEmail);
          if (!recipientQuota.ok) return tooManyRequestsResponse(recipientQuota.retryAfter);
        }

        try {
          await deps.licenses.giftCopy(actor, roomId, body);
        } catch (err) {
          if (!(err instanceof RoomLicenseError) || err.code !== "RECIPIENT_NOT_FOUND") throw err;
        }
        return Response.json(
          { message: "Si existe una cuenta con ese email, verá la copia al iniciar sesión." },
          { status: 202, headers: NO_STORE },
        );
      });
    },
  };
}
