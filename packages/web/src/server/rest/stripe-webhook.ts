import type Stripe from "stripe";
import {
  EventError,
  PurchaseError,
  RoomLicenseError,
  type EventService,
  type PurchaseConfirmationQueue,
  type PurchaseService,
  type RoomLicenseService,
  type WebhookEventDedupeStore,
} from "@escaperoom/shared/services";
import { logger } from "@escaperoom/kit/logger";

/** Dependencias inyectables del webhook (testeables sin Postgres ni Stripe). */
export type StripeWebhookHandlerDeps = {
  purchases: PurchaseService;
  roomLicenses: RoomLicenseService;
  events: EventService;
  dedupe: WebhookEventDedupeStore;
  /**
   * Cola del email de confirmación de compra (specs/18 §3-4): se encola tras
   * liquidar cada `checkout.session.completed`, para los tres `purchaseType`.
   */
  confirmations: PurchaseConfirmationQueue;
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

function eventIdFromMetadata(metadata: Stripe.Metadata | null | undefined): string | null {
  return metadata?.eventId ?? null;
}

/**
 * `enqueue` no lanza (E-11): si Redis está caído justo al liquidar el pago,
 * devuelve `null` en silencio (por diseño — no puede tumbar el webhook de
 * Stripe, que Stripe reintenta por otro motivo, no por este). Antes eso
 * significaba que el email de confirmación se perdía sin dejar ni un log. El
 * barrido periódico (`purchase-confirmation-outbox`, packages/worker) lo
 * reencola de todas formas vía `confirmationSentAt`; esto es solo la
 * visibilidad de que ocurrió, para que no pase desapercibido en producción.
 */
async function enqueueConfirmation(
  confirmations: PurchaseConfirmationQueue,
  job: Parameters<PurchaseConfirmationQueue["enqueue"]>[0],
): Promise<void> {
  const jobId = await confirmations.enqueue(job);
  if (jobId === null) {
    logger.error(
      { kind: job.kind, ref: "purchaseId" in job ? job.purchaseId : job.eventId },
      "stripe-webhook: no se pudo encolar el email de confirmación de compra (Redis caído o colas deshabilitadas)",
    );
  }
}

/**
 * Procesa un evento ya verificado. Cubre los tres `purchaseType`
 * (`room`, `room_license`, `event_credits`); sin pasarela cableada
 * (`getPurchaseService`/`getEventService`/`getRoomLicenseService` con
 * `payments: null`), esos checkouts nunca se abren y este dispatcher nunca
 * recibe un pago real de ellos.
 */
async function dispatch(deps: StripeWebhookHandlerDeps, event: Stripe.Event): Promise<void> {
  const { purchases, roomLicenses, events, confirmations } = deps;
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      switch (session.metadata?.purchaseType) {
        case "room": {
          const purchaseId = purchaseIdFromMetadata(session.metadata);
          if (!purchaseId || !paymentIntentId) return;
          await purchases.confirmRoomCheckout({ purchaseId, paymentIntentId });
          // Contrato por escrito + renuncia al desistimiento en soporte duradero
          // (specs/18 §3-4, art. 27 LSSI, art. 103.m LGDCU): un email propio, el
          // recibo de Stripe no basta.
          await enqueueConfirmation(confirmations, { kind: "room", purchaseId });
          return;
        }
        case "room_license": {
          const purchaseId = purchaseIdFromMetadata(session.metadata);
          if (!purchaseId || !paymentIntentId) return;
          await roomLicenses.confirmLicensePayment(purchaseId, { paymentRef: paymentIntentId });
          await enqueueConfirmation(confirmations, { kind: "room_license", purchaseId });
          return;
        }
        case "event_credits": {
          const eventId = eventIdFromMetadata(session.metadata);
          if (!eventId) return;
          await events.markPaid(eventId);
          await enqueueConfirmation(confirmations, { kind: "event_credits", eventId });
          return;
        }
        default:
          return;
      }
    }
    case "payment_intent.payment_failed": {
      const intent = event.data.object;
      switch (intent.metadata?.purchaseType) {
        case "room": {
          const purchaseId = purchaseIdFromMetadata(intent.metadata);
          if (!purchaseId) return;
          await purchases.markCheckoutFailed(purchaseId);
          return;
        }
        case "room_license": {
          const purchaseId = purchaseIdFromMetadata(intent.metadata);
          if (!purchaseId) return;
          await roomLicenses.markCheckoutFailed(purchaseId);
          return;
        }
        case "event_credits": {
          const eventId = eventIdFromMetadata(intent.metadata);
          if (!eventId) return;
          await events.markCheckoutFailed(eventId);
          return;
        }
        default:
          return;
      }
    }
    case "charge.refunded": {
      const charge = event.data.object;
      const paymentIntentId =
        typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (!paymentIntentId) return;
      // Solo cubre `purchase_type: 'room'` (revoca acceso). Para `room_license`
      // y `event_credits` el reembolso queda registrado en Stripe pero no
      // revoca el fork ni bloquea el evento todavía (pendiente de una
      // iteración posterior, specs/13 §7).
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
        await dispatch(deps, event);
      } catch (err) {
        // Se deshace el registro de idempotencia para que el reintento de
        // Stripe (mismo `event.id`) vuelva a procesarse.
        await deps.dedupe.forget(event.id);
        if (err instanceof PurchaseError || err instanceof RoomLicenseError || err instanceof EventError) {
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
