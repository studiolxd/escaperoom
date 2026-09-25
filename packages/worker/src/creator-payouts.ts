import type { Queue, Worker } from "bullmq";
import type Redis from "ioredis";
import type { ConnectGateway, CreatorPayoutStore, PaymentGateway } from "@escaperoom/shared/services";
import { processCreatorPayouts } from "@escaperoom/shared/services";
import { createScheduledWorker } from "./scheduled-worker";

/**
 * Barrido de reparto a creadores (B-9, auditoría 2026-09-24): ver el
 * comentario de cabecera de `@escaperoom/shared/services/creator-payouts.ts`.
 * Cada 5 minutos reintenta la `Transfer` de cualquier compra `room`/
 * `room_license` `succeeded` sin `stripeTransferId`, fuera del camino
 * crítico del webhook de Stripe.
 */

export const CREATOR_PAYOUTS_QUEUE_NAME = "payouts.creator-transfer";
export const CREATOR_PAYOUTS_SCHEDULER_ID = "creator-payouts-sweep";
export const DEFAULT_CREATOR_PAYOUTS_EVERY_MS = 300_000;
export const DEFAULT_CREATOR_PAYOUTS_LIMIT = 100;

export type CreatorPayoutsWorkerOptions = {
  store: CreatorPayoutStore;
  connect: ConnectGateway;
  payments: PaymentGateway;
  /** Conexión dedicada de worker (`createQueueRedis()`); bloquea en BRPOPLPUSH. */
  connection: Redis;
  everyMs?: number;
  limit?: number;
};

/** Crea el `Worker` y registra (o actualiza) el scheduler del barrido. */
export async function createCreatorPayoutsWorker(
  opts: CreatorPayoutsWorkerOptions,
): Promise<{ worker: Worker; queue: Queue }> {
  const everyMs = opts.everyMs ?? DEFAULT_CREATOR_PAYOUTS_EVERY_MS;
  return createScheduledWorker({
    name: "creator payouts",
    schedulerId: CREATOR_PAYOUTS_SCHEDULER_ID,
    jobName: "sweep",
    repeat: { every: everyMs },
    connection: opts.connection,
    queueName: CREATOR_PAYOUTS_QUEUE_NAME,
    process: () =>
      processCreatorPayouts(
        { store: opts.store, connect: opts.connect, payments: opts.payments },
        { limit: opts.limit ?? DEFAULT_CREATOR_PAYOUTS_LIMIT },
      ),
  });
}
