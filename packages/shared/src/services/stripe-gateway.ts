import Stripe from "stripe";
import type { ConnectAccountStatus, ConnectGateway } from "./creator-connect";
import type { PaymentGateway } from "./events";

/**
 * Adaptador real de Stripe (ticket 5.1). A diferencia del resto de clientes
 * HTTP del repo (`elevenlabs-client.ts`), aquí SÍ se usa el SDK oficial: la
 * verificación de firma de webhooks (`stripe.webhooks.constructEvent`) es
 * criptografía de seguridad que no conviene reimplementar a mano, y el SDK
 * también tipa el resto de la superficie (Checkout, Connect, Transfers).
 */

export type StripeConfig = { configured: false } | { configured: true; secretKey: string; webhookSecret: string | null };

/**
 * Configuración desde el entorno:
 *
 * | Variable | Uso |
 * | --- | --- |
 * | `STRIPE_SECRET_KEY` | Clave secreta del entorno de test/producción. Sin ella, checkout, Connect y el webhook no están disponibles. |
 * | `STRIPE_WEBHOOK_SECRET` | Firma del endpoint (`stripe listen` en local, o el Dashboard en producción). Sin ella, el webhook responde 503: nunca se procesa un evento sin verificar la firma. |
 */
export function readStripeConfig(env: Record<string, string | undefined> = process.env): StripeConfig {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return { configured: false };
  return { configured: true, secretKey, webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || null };
}

/** Cliente Stripe compartido por el gateway de pagos, Connect y el webhook. */
export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { appInfo: { name: "escaperoom" } });
}

function toAmount(cents: number): number {
  // Stripe usa la unidad menor de la moneda (céntimos para EUR); `room.priceCents`
  // ya está en esa unidad (specs/02).
  return cents;
}

/** Pasarela de Checkout + Transfers (specs/02 §2, specs/13 §5-7). */
export function createStripePaymentGateway(stripe: Stripe): PaymentGateway {
  return {
    async createEventCheckout(input) {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: toAmount(input.amountCents),
              product_data: { name: `${input.title} — evento (${input.players} jugadores)` },
            },
            quantity: 1,
          },
        ],
        metadata: { purchaseType: "event_credits", eventId: input.eventId, organizerId: input.organizerId },
        // `eventId` también en el PaymentIntent: `payment_intent.payment_failed`
        // solo trae el PaymentIntent, no la Session que lo originó.
        payment_intent_data: {
          metadata: { purchaseType: "event_credits", eventId: input.eventId },
        },
        success_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/es/checkout/confirmation?type=event_credits&status=success&eventId=${input.eventId}`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/es/checkout/confirmation?type=event_credits&status=cancelled&eventId=${input.eventId}`,
      });
      return { checkoutRef: session.id, url: session.url ?? "" };
    },
    async createLicenseCheckout(input) {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: toAmount(input.amountCents),
              product_data: { name: `Licencia: ${input.title}` },
            },
            quantity: 1,
          },
        ],
        metadata: { purchaseType: "room_license", purchaseId: input.purchaseId },
        payment_intent_data: { metadata: { purchaseType: "room_license", purchaseId: input.purchaseId } },
        // Igual que el resto de checkouts (specs/13 §5): la confirmación se
        // sirve en `es` (`DEFAULT_LOCALE`), la pasarela no conoce el idioma.
        success_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/es/checkout/confirmation?type=room_license&status=success&roomId=${input.roomId}`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/es/checkout/confirmation?type=room_license&status=cancelled&roomId=${input.roomId}`,
      });
      return { checkoutRef: session.id, url: session.url ?? "" };
    },
    async createRoomCheckout(input) {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: toAmount(input.amountCents),
              product_data: { name: input.title },
            },
            quantity: 1,
          },
        ],
        // `purchaseId` en la Session Y en el PaymentIntent: `payment_intent.payment_failed`
        // solo trae el PaymentIntent, no la Session que lo originó.
        metadata: { purchaseType: "room", purchaseId: input.purchaseId },
        payment_intent_data: { metadata: { purchaseType: "room", purchaseId: input.purchaseId } },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });
      return { checkoutRef: session.id, url: session.url ?? "" };
    },
    async createTransfer(input) {
      const transfer = await stripe.transfers.create({
        amount: toAmount(input.amountCents),
        currency: input.currency.toLowerCase(),
        destination: input.destinationAccountId,
        // Financia la transferencia con el cargo original (specs/02 §2): la
        // plataforma nunca adelanta de su propio balance.
        source_transaction: await chargeIdForPaymentIntent(stripe, input.paymentIntentId),
        transfer_group: `purchase_${input.purchaseId}`,
      });
      return { transferId: transfer.id };
    },
  };
}

async function chargeIdForPaymentIntent(stripe: Stripe, paymentIntentId: string): Promise<string | undefined> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  const charge = pi.latest_charge;
  return typeof charge === "string" ? charge : charge?.id;
}

/**
 * Onboarding de Connect (specs/02 §2): cuentas Express `recipient` — el
 * creador solo recibe transferencias, nunca cobra directo, así que no se pide
 * la capacidad `card_payments`/`merchant`.
 */
export function createStripeConnectGateway(stripe: Stripe): ConnectGateway {
  return {
    async createExpressAccount({ email }) {
      // `controller` ya fija el tipo de cuenta (Express dashboard, `recipient`
      // con pricing/pérdidas de la plataforma, specs/02 §2): `type` y
      // `controller` son mutuamente excluyentes en la API de Stripe.
      const account = await stripe.accounts.create({
        email,
        capabilities: { transfers: { requested: true } },
        controller: {
          losses: { payments: "application" },
          fees: { payer: "application" },
          stripe_dashboard: { type: "express" },
        },
      });
      return { accountId: account.id };
    },
    async createOnboardingLink({ accountId, refreshUrl, returnUrl }) {
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: "account_onboarding",
      });
      return { url: link.url };
    },
    async getAccountStatus(accountId): Promise<ConnectAccountStatus> {
      const account = await stripe.accounts.retrieve(accountId);
      if (account.details_submitted && account.payouts_enabled) return "complete";
      return "pending";
    },
    async createDashboardLink(accountId) {
      const link = await stripe.accounts.createLoginLink(accountId);
      return { url: link.url };
    },
  };
}

export class StripeSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeSignatureError";
  }
}

/** Verifica `Stripe-Signature` con `STRIPE_WEBHOOK_SECRET` antes de procesar (specs/13 §7). */
export function verifyStripeWebhookSignature(
  stripe: Stripe,
  payload: string | Buffer,
  signature: string,
  webhookSecret: string,
): Stripe.Event {
  try {
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    throw new StripeSignatureError(err instanceof Error ? err.message : "Firma no válida");
  }
}
