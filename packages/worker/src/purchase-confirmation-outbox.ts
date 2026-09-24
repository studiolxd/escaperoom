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
 * compra `succeeded`/evento pagado que lleve más de `graceMs` sin ella.
 *
 * Ventana acotada (revisión de PR #119): sin cota inferior, al desplegar esto
 * reenviaría el email a TODA compra succeeded/evento pagado histórico (los
 * previos a la migración de #114, que nunca lo recibieron, y los posteriores,
 * que ya lo recibieron pero sin marcador). `maxAgeMs` fija cuánto se reintenta
 * antes de darlo por abandonado: pasado ese punto se deja de reencolar y se
 * reporta como error en vez de insistir cada `everyMs` para siempre.
 *
 * "Abandonado" también tiene cota inferior (segunda revisión de PR #119):
 * sin ella, cada fila que cruza `maxAgeMs` seguiría cayendo en el bucket
 * "abandoned" — y alertándose por `logger.error` — en TODAS las pasadas
 * futuras mientras nadie la confirme a mano, para siempre. Se acota a lo que
 * cruzó el umbral justo en el último intervalo (`everyMs`) de barrido: cada
 * fila se reporta una única vez, en el primer barrido tras abandonarse.
 */

export const PURCHASE_CONFIRMATION_OUTBOX_QUEUE_NAME = "mail.purchase-confirmation-outbox";
/** Id estable del scheduler: reiniciar el worker no duplica la repetición. */
export const PURCHASE_CONFIRMATION_OUTBOX_SCHEDULER_ID = "purchase-confirmation-outbox-sweep";
/** Cada 5 minutos: encolar de más es inocuo (BullMQ dedupe por jobId no aplica aquí, pero reenviar dos veces solo duplica un email, no corrompe nada). */
export const DEFAULT_PURCHASE_CONFIRMATION_OUTBOX_EVERY_MS = 300_000;
/** No tocar nada creado/pagado en los últimos 10 minutos: dale tiempo al webhook. */
export const DEFAULT_PURCHASE_CONFIRMATION_GRACE_MS = 600_000;
/** Pasados 7 días sin confirmar, se da por abandonado (deja de reencolarse, se alerta). */
export const DEFAULT_PURCHASE_CONFIRMATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Tope de filas por bucket y pasada: una tabla grande sin marcar no debe volver el barrido sin límite. */
export const DEFAULT_PURCHASE_CONFIRMATION_OUTBOX_LIMIT = 200;

export type PurchaseConfirmationOutboxResult = { pending: number; reenqueued: number; abandoned: number };

/** Una pasada del barrido; registra cuántas encontró, cuántas logró reencolar y cuántas abandonó. */
export async function processPurchaseConfirmationOutbox(
  store: PurchaseConfirmationStore,
  confirmations: PurchaseConfirmationQueue,
  opts: { graceMs?: number; maxAgeMs?: number; everyMs?: number; limit?: number; now?: Date } = {},
): Promise<PurchaseConfirmationOutboxResult> {
  const now = (opts.now ?? new Date()).getTime();
  const everyMs = opts.everyMs ?? DEFAULT_PURCHASE_CONFIRMATION_OUTBOX_EVERY_MS;
  const recentCutoff = new Date(now - (opts.graceMs ?? DEFAULT_PURCHASE_CONFIRMATION_GRACE_MS));
  const abandonCutoff = new Date(now - (opts.maxAgeMs ?? DEFAULT_PURCHASE_CONFIRMATION_MAX_AGE_MS));
  // Ventana de "abandoned" = el propio intervalo de barrido: cada fila cruza
  // el umbral una sola vez, así que solo aparece en la pasada cuyo intervalo
  // la contiene.
  const abandonWindowStart = new Date(abandonCutoff.getTime() - everyMs);
  const limit = opts.limit ?? DEFAULT_PURCHASE_CONFIRMATION_OUTBOX_LIMIT;

  const { pending, abandoned } = await store.findPendingConfirmations({
    recentCutoff,
    abandonCutoff,
    abandonWindowStart,
    limit,
  });

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
  if (abandoned.length > 0) {
    // No se reencolan: llevan más de `maxAgeMs` sin confirmar pese a los
    // intentos del webhook, del worker de entrega y de este mismo barrido —
    // insistir no va a arreglarlo solo. Requiere mirarlo a mano.
    logger.error(
      { abandoned: abandoned.length, jobs: abandoned },
      "purchase confirmation outbox: envíos abandonados (más del margen máximo sin confirmar, requieren revisión manual)",
    );
  }
  return { pending: pending.length, reenqueued, abandoned: abandoned.length };
}

export type PurchaseConfirmationOutboxWorkerOptions = {
  store: PurchaseConfirmationStore;
  /** Por defecto, `createPurchaseConfirmationEmailQueue()` (misma cola que consume el webhook). */
  confirmations?: PurchaseConfirmationQueue;
  /** Conexión dedicada de worker (`createQueueRedis()`); bloquea en BRPOPLPUSH. */
  connection: Redis;
  everyMs?: number;
  graceMs?: number;
  maxAgeMs?: number;
  limit?: number;
  now?: () => Date;
};

/** Crea el `Worker` y registra (o actualiza) el scheduler del barrido. */
export async function createPurchaseConfirmationOutboxWorker(
  opts: PurchaseConfirmationOutboxWorkerOptions,
): Promise<{ worker: Worker; queue: Queue }> {
  const confirmations = opts.confirmations ?? createPurchaseConfirmationEmailQueue();
  const everyMs = opts.everyMs ?? DEFAULT_PURCHASE_CONFIRMATION_OUTBOX_EVERY_MS;
  return createScheduledWorker({
    name: "purchase confirmation outbox",
    schedulerId: PURCHASE_CONFIRMATION_OUTBOX_SCHEDULER_ID,
    jobName: "sweep",
    repeat: { every: everyMs },
    connection: opts.connection,
    queueName: PURCHASE_CONFIRMATION_OUTBOX_QUEUE_NAME,
    process: () =>
      processPurchaseConfirmationOutbox(opts.store, confirmations, {
        graceMs: opts.graceMs,
        maxAgeMs: opts.maxAgeMs,
        everyMs,
        limit: opts.limit,
        now: opts.now?.(),
      }),
  });
}
