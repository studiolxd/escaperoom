import type { Queue, Worker } from "bullmq";
import type Redis from "ioredis";
import { logger } from "@escaperoom/kit/logger";
import {
  purgeStripeWebhookEvents,
  type StripeWebhookEventPurgeStore,
} from "@escaperoom/shared/services";
import { createScheduledWorker } from "./scheduled-worker";

/**
 * Job de purga de `stripeWebhookEvent` (B-19): un scheduler de BullMQ encola
 * una pasada cada `everyMs`; cada pasada es un DELETE simple (sin condición de
 * idempotencia que comprobar), así que solaparse o repetir una pasada es
 * inocuo.
 */

export const STRIPE_WEBHOOK_PURGE_QUEUE_NAME = "stripe.webhook-event-purge";
/** Id estable del scheduler: reiniciar el worker no duplica la repetición. */
export const STRIPE_WEBHOOK_PURGE_SCHEDULER_ID = "stripe-webhook-event-purge-sweep";
/** El plazo es de 30 días: basta con pasar una vez al día. */
export const DEFAULT_STRIPE_WEBHOOK_PURGE_EVERY_MS = 24 * 60 * 60 * 1000;

/** Una pasada del job; registra cuántas filas borró. */
export async function processStripeWebhookEventPurge(
  store: StripeWebhookEventPurgeStore,
  now: Date = new Date(),
): Promise<number> {
  const deleted = await purgeStripeWebhookEvents(store, now);
  if (deleted > 0) logger.info({ deleted }, "stripe webhook purge: filas borradas");
  return deleted;
}

export type StripeWebhookPurgeWorkerOptions = {
  store: StripeWebhookEventPurgeStore;
  /** Conexión dedicada de worker (`createQueueRedis()`); bloquea en BRPOPLPUSH. */
  connection: Redis;
  everyMs?: number;
};

/**
 * Crea el `Worker` y registra (o actualiza) el scheduler repetitivo. Devuelve
 * ambos para que el arranque los cierre en el apagado.
 */
export async function createStripeWebhookPurgeWorker(
  opts: StripeWebhookPurgeWorkerOptions,
): Promise<{ worker: Worker; queue: Queue }> {
  return createScheduledWorker({
    name: "stripe webhook purge",
    schedulerId: STRIPE_WEBHOOK_PURGE_SCHEDULER_ID,
    jobName: "sweep",
    repeat: { every: opts.everyMs ?? DEFAULT_STRIPE_WEBHOOK_PURGE_EVERY_MS },
    connection: opts.connection,
    queueName: STRIPE_WEBHOOK_PURGE_QUEUE_NAME,
    process: () => processStripeWebhookEventPurge(opts.store),
  });
}
