import { verifyStripeWebhookSignature } from "@escaperoom/shared/services";
import { createStripeWebhookHandlers } from "@/server/rest/stripe-webhook";
import {
  getPurchaseService,
  getStripeClient,
  getStripeWebhookSecret,
  getWebhookEventDedupeStore,
} from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/stripe/webhook — único punto de entrada de eventos de Stripe
 * (specs/13 §7), autenticado por `Stripe-Signature`, nunca por sesión. Sin
 * `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` responde 503: nunca se procesa
 * un evento sin verificar antes la firma.
 */
export async function POST(request: Request): Promise<Response> {
  const stripe = getStripeClient();
  const webhookSecret = getStripeWebhookSecret();
  if (!stripe || !webhookSecret) {
    return Response.json(
      { error: { code: "PAYMENT_GATEWAY_UNAVAILABLE", message: "El webhook de Stripe no está configurado" } },
      { status: 503, headers: NO_STORE },
    );
  }
  return createStripeWebhookHandlers({
    purchases: getPurchaseService(),
    dedupe: getWebhookEventDedupeStore(),
    verify: (payload, signature) => verifyStripeWebhookSignature(stripe, payload, signature, webhookSecret),
  }).postWebhook(request);
}
