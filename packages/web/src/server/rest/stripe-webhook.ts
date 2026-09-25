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
 * `checkout.session.completed`/`checkout.session.async_payment_succeeded`
 * (B-12: solo se liquida con `payment_status === "paid"` — un método de pago
 * asíncrono como SEPA llega a `completed` con `payment_status: "unpaid"` y
 * solo pasa a `paid` en el evento `async_payment_succeeded` posterior).
 */
async function settleCheckoutSession(deps: StripeWebhookHandlerDeps, session: Stripe.Checkout.Session): Promise<void> {
  if (session.payment_status !== "paid") return;
  const { purchases, roomLicenses, events, confirmations } = deps;
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
      // B-1/B-8: el webhook liquida por `purchaseId` (la `purchase`
      // `event_credits` `pending` congelada al abrir el checkout), nunca
      // recalculando desde `eventId`/`playersPurchased` en este instante.
      const purchaseId = purchaseIdFromMetadata(session.metadata);
      const eventId = eventIdFromMetadata(session.metadata);
      if (!purchaseId || !eventId || !paymentIntentId) return;
      const result = await events.markPaid({
        purchaseId,
        sessionId: session.id,
        paymentIntentId,
        amountTotalCents: session.amount_total ?? 0,
      });
      // Solo se encola el email la vez que de verdad se liquida: en un replay
      // (`already_settled`) o un desajuste (`mismatch`, ya registrado por
      // `events.markPaid`) no hay nada nuevo que confirmar.
      if (result.outcome === "settled") {
        await enqueueConfirmation(confirmations, { kind: "event_credits", eventId });
      }
      return;
    }
    default:
      return;
  }
}

/** `payment_intent.payment_failed`/`checkout.session.async_payment_failed`: `pending → failed` (room/room_license). */
async function handlePaymentFailure(
  deps: StripeWebhookHandlerDeps,
  metadata: Stripe.Metadata | null | undefined,
): Promise<void> {
  switch (metadata?.purchaseType) {
    case "room": {
      const purchaseId = purchaseIdFromMetadata(metadata);
      if (purchaseId) await deps.purchases.markCheckoutFailed(purchaseId);
      return;
    }
    case "room_license": {
      const purchaseId = purchaseIdFromMetadata(metadata);
      if (purchaseId) await deps.roomLicenses.markCheckoutFailed(purchaseId);
      return;
    }
    case "event_credits":
      // B-1: a diferencia de `room`/`room_license`, un fallo de cobro de
      // evento NO libera el checkout — Stripe Checkout deja reintentar con
      // otra tarjeta en la MISMA Session (el cliente ni sale de la página),
      // así que el importe congelado sigue protegiendo el precio. Solo
      // `checkout.session.expired` (o `startCheckout` reabriendo a propósito)
      // libera el hueco. Ver `EventService.markCheckoutExpired`.
      return;
    default:
      return;
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
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await settleCheckoutSession(deps, event.data.object);
      return;
    case "checkout.session.async_payment_failed":
      await handlePaymentFailure(deps, event.data.object.metadata);
      return;
    case "checkout.session.expired": {
      // B-1/B-12: única vía que libera el checkout de un evento (24 h sin
      // completar, o expirado a propósito por `startCheckout` al reabrir).
      const session = event.data.object;
      if (session.metadata?.purchaseType !== "event_credits") return;
      const eventId = eventIdFromMetadata(session.metadata);
      if (!eventId) return;
      await deps.events.markCheckoutExpired({ eventId, sessionId: session.id });
      return;
    }
    case "payment_intent.payment_failed":
      await handlePaymentFailure(deps, event.data.object.metadata);
      return;
    case "charge.refunded": {
      const charge = event.data.object;
      const paymentIntentId =
        typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (!paymentIntentId) return;
      const refund = {
        paymentIntentId,
        amountRefundedCents: charge.amount_refunded,
        chargeAmountCents: charge.amount,
      };
      // Se prueba cada tipo de compra por su `paymentIntentId` (único en
      // Stripe): más simple y más fiable que fiarse de que Stripe copie la
      // metadata del PaymentIntent al Charge (B-5, reembolsos parciales
      // registrados sin revocar acceso; total revierte la Transfer si la hubo).
      if (await deps.purchases.markRefunded(refund)) return;
      if (await deps.roomLicenses.markRefunded(refund)) return;
      await deps.events.markRefunded(paymentIntentId);
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
