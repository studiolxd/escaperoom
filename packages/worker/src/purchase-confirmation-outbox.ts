import type { Queue, Worker } from "bullmq";
import type Redis from "ioredis";
import { logger } from "@escaperoom/kit/logger";
import { createPurchaseConfirmationEmailQueue } from "@escaperoom/shared/mail";
import type { PurchaseConfirmationQueue, PurchaseConfirmationStore } from "@escaperoom/shared/services";
import { createScheduledWorker } from "./scheduled-worker";

/**
 * Outbox mínimo del email de confirmación de compra (E-11, PR #114). El
 * webhook de Stripe encola el envío en Redis justo tras liquidar el pago; si
 * Redis está caído en ese instante exacto, `enqueue()` devuelve `null` (no
 * lanza — no puede tumbar el webhook) y, sin este barrido, el email se
 * perdía sin más rastro que un log.
 *
 * `purchase.confirmationSentAt`/`event.confirmationSentAt` son la marca de
 * verdad en Postgres (la pone el worker de entrega tras un envío que no
 * lanzó, nunca el webhook al encolar): este job periódico reencola cualquier
 * compra `succeeded`/evento pagado que lleve más de `graceMs` sin ella. El
 * margen de gracia evita competir con el intento normal del propio webhook.
 */

export const PURCHASE_CONFIRMATION_OUTBOX_QUEUE_NAME = "mail.purchase-confirmation-outbox";
/** Id estable del scheduler: reiniciar el worker no duplica la repetición. */
export const PURCHASE_CONFIRMATION_OUTBOX_SCHEDULER_ID = "purchase-confirmation-outbox-sweep";
/** Cada 5 minutos: encolar de más es inocuo (BullMQ dedupe por jobId no aplica aquí, pero reenviar dos veces solo duplica un email, no corrompe nada). */
export const DEFAULT_PURCHASE_CONFIRMATION_OUTBOX_EVERY_MS = 300_000;
/** No tocar nada creado en los últimos 10 minutos: dale tiempo al webhook. */
export const DEFAULT_PURCHASE_CONFIRMATION_GRACE_MS = 600_000;

export type PurchaseConfirmationOutboxResult = { pending: number; reenqueued: number };

/** Una pasada del barrido; registra cuántas encontró y cuántas logró reencolar. */
export async function processPurchaseConfirmationOutbox(
  store: PurchaseConfirmationStore,
  confirmations: PurchaseConfirmationQueue,
  opts: { graceMs?: number; now?: Date } = {},
): Promise<PurchaseConfirmationOutboxResult> {
  const cutoff = new Date((opts.now ?? new Date()).getTime() - (opts.graceMs ?? DEFAULT_PURCHASE_CONFIRMATION_GRACE_MS));
  const pending = await store.findPendingConfirmations(cutoff);

  let reenqueued = 0;
  for (const job of pending) {
    if ((await confirmations.enqueue(job)) !== null) reenqueued++;
  }

  if (pending.length > 0) {
    logger[reenqueued === pending.length ? "warn" : "error"](
      { pending: pending.length, reenqueued },
      "purchase confirmation outbox: reencolados envíos que llevaban sin confirmar más del margen de gracia",
    );
  }
  return { pending: pending.length, reenqueued };
}

export type PurchaseConfirmationOutboxWorkerOptions = {
  store: PurchaseConfirmationStore;
  /** Por defecto, `createPurchaseConfirmationEmailQueue()` (misma cola que consume el webhook). */
  confirmations?: PurchaseConfirmationQueue;
  /** Conexión dedicada de worker (`createQueueRedis()`); bloquea en BRPOPLPUSH. */
  connection: Redis;
  everyMs?: number;
  graceMs?: number;
  now?: () => Date;
};

/** Crea el `Worker` y registra (o actualiza) el scheduler del barrido. */
export async function createPurchaseConfirmationOutboxWorker(
  opts: PurchaseConfirmationOutboxWorkerOptions,
): Promise<{ worker: Worker; queue: Queue }> {
  const confirmations = opts.confirmations ?? createPurchaseConfirmationEmailQueue();
  return createScheduledWorker({
    name: "purchase confirmation outbox",
    schedulerId: PURCHASE_CONFIRMATION_OUTBOX_SCHEDULER_ID,
    jobName: "sweep",
    repeat: { every: opts.everyMs ?? DEFAULT_PURCHASE_CONFIRMATION_OUTBOX_EVERY_MS },
    connection: opts.connection,
    queueName: PURCHASE_CONFIRMATION_OUTBOX_QUEUE_NAME,
    process: () =>
      processPurchaseConfirmationOutbox(opts.store, confirmations, {
        graceMs: opts.graceMs,
        now: opts.now?.(),
      }),
  });
}
