import type Stripe from "stripe";
import { PurchaseError, type PurchaseService, type WebhookEventDedupeStore } from "@escaperoom/shared/services";
import { logger } from "@escaperoom/kit/logger";

/** Dependencias inyectables del webhook (testeables sin Postgres ni Stripe). */
export type StripeWebhookHandlerDeps = {
  purchases: PurchaseService;
  dedupe: WebhookEventDedupeStore;
  /** Verifica `Stripe-Signature` y devuelve el evento tipado; lanza si la firma no es válida. */
  verify: (payload: string, signature: string) => Stripe.Event;
};

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status, headers: NO_STORE });
}

/** `purchaseId` viaja en `metadata` de la Session Y del PaymentIntent (specs/13 §7). */
function purchaseIdFromMetadata(metadata: Stripe.Metadata | null | undefined): string | null {
  return metadata?.purchaseId ?? null;
}

/**
 * Procesa un evento ya verificado. Solo `purchase_type: 'room'` está cableado
 * en esta iteración (checkout individual + reparto); `room_license` y
 * `event_credits` siguen respondiendo `PAYMENT_GATEWAY_UNAVAILABLE` al abrir
 * el checkout (`getEventService`/`getRoomLicenseService` con `payments: null`),
 * así que nunca llegan aquí con un pago real.
 */
async function dispatch(purchases: PurchaseService, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const purchaseId = purchaseIdFromMetadata(session.metadata);
      const paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (session.metadata?.purchaseType !== "room" || !purchaseId || !paymentIntentId) return;
      await purchases.confirmRoomCheckout({ purchaseId, paymentIntentId });
      return;
    }
    case "payment_intent.payment_failed": {
      const intent = event.data.object;
      const purchaseId = purchaseIdFromMetadata(intent.metadata);
      if (intent.metadata?.purchaseType !== "room" || !purchaseId) return;
      await purchases.markCheckoutFailed(purchaseId);
      return;
    }
    case "charge.refunded": {
      const charge = event.data.object;
      const paymentIntentId =
        typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (!paymentIntentId) return;
      await purchases.markRefunded(paymentIntentId);
      return;
    }
    case "account.updated":
      // El estado de onboarding se consulta en vivo a Stripe
      // (`GET /api/me/stripe-connect/status`), nunca se cachea en Postgres:
      // no hace falta ninguna escritura aquí.
      return;
    default:
      return;
  }
}

/**
 * Handler REST del webhook de Stripe (specs/13 §7): único punto de entrada de
 * eventos, autenticado por firma (`Stripe-Signature`), no por sesión.
 */
export function createStripeWebhookHandlers(deps: StripeWebhookHandlerDeps) {
  return {
    async postWebhook(request: Request): Promise<Response> {
      const signature = request.headers.get("stripe-signature");
      if (!signature) return errorResponse("MISSING_SIGNATURE", "Falta Stripe-Signature", 400);

      const payload = await request.text();
      let event: Stripe.Event;
      try {
        event = deps.verify(payload, signature);
      } catch {
        return errorResponse("INVALID_SIGNATURE", "Firma no válida", 400);
      }

      // Idempotencia: Stripe reintenta y no garantiza entrega única.
      const isNew = await deps.dedupe.recordIfNew(event.id, event.type);
      if (!isNew) return Response.json({ received: true, duplicate: true }, { headers: NO_STORE });

      try {
        await dispatch(deps.purchases, event);
      } catch (err) {
        // Se deshace el registro de idempotencia para que el reintento de
        // Stripe (mismo `event.id`) vuelva a procesarse.
        await deps.dedupe.forget(event.id);
        if (err instanceof PurchaseError) {
          logger.warn({ eventId: event.id, type: event.type, code: err.code }, "stripe-webhook: error de dominio");
          return errorResponse(err.code, err.message, 500);
        }
        logger.error({ eventId: event.id, type: event.type, err }, "stripe-webhook: error inesperado");
        return errorResponse("INTERNAL_ERROR", "Error procesando el evento", 500);
      }

      return Response.json({ received: true }, { headers: NO_STORE });
    },
  };
}
