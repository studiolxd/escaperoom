/**
 * Purga de `stripeWebhookEvent` (B-19): la tabla de deduplicación del webhook
 * (`stripe-webhook-dedupe.ts`) solo necesita conservar un `event.id` mientras
 * Stripe pueda reintentarlo — unos pocos días como mucho — pero nada la
 * limpiaba nunca, así que crecía sin límite. 30 días es un margen amplio
 * sobre la ventana de reintentos real de Stripe.
 */

/** Días hasta que una fila de `stripeWebhookEvent` se considera purgable. */
export const STRIPE_WEBHOOK_EVENT_RETENTION_DAYS = 30;

/** Instante a partir del cual una fila de hace `days` días ya está fuera de plazo. */
export function stripeWebhookEventPurgeCutoff(
  now: Date,
  days: number = STRIPE_WEBHOOK_EVENT_RETENTION_DAYS,
): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff;
}

/** Puerto de persistencia del job (mismo patrón que el resto de purgas). */
export interface StripeWebhookEventPurgeStore {
  /** Borra las filas con `receivedAt` anterior al cutoff; devuelve cuántas. */
  deleteExpired(cutoff: Date): Promise<number>;
}

/** Pasada del job; delega toda la selección al store (SQL o memoria). */
export function purgeStripeWebhookEvents(
  store: StripeWebhookEventPurgeStore,
  now: Date,
): Promise<number> {
  return store.deleteExpired(stripeWebhookEventPurgeCutoff(now));
}
