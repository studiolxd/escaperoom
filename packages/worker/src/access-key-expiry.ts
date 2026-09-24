import type { Queue, Worker } from "bullmq";
import type Redis from "ioredis";
import { logger } from "@escaperoom/kit/logger";
import {
  expireAccessKeys,
  type AccessKeyStore,
  type ExpirySweepResult,
} from "@escaperoom/shared/services";
import { createScheduledWorker } from "./scheduled-worker";

/**
 * Job de caducidad de claves (ticket 5.5, specs/02 §4.3). Un scheduler de BullMQ
 * encola una pasada cada `everyMs`; cada pasada aplica las tres reglas de
 * `expiryRules` (`hours_after_start`, `on_session_end`, `on_group_complete`)
 * con UPDATE idempotentes, así que solaparse o repetir una pasada es inocuo.
 */

export const ACCESS_KEY_EXPIRY_QUEUE_NAME = "access-keys.expiry";
/** Id estable del scheduler: reiniciar el worker no duplica la repetición. */
export const ACCESS_KEY_EXPIRY_SCHEDULER_ID = "access-keys-expiry-sweep";
export const DEFAULT_ACCESS_KEY_EXPIRY_EVERY_MS = 60_000;

type ExpiryStore = Pick<
  AccessKeyStore,
  "expireByDeadline" | "expireBySessionEnd" | "expireByGroupComplete"
>;

/** Una pasada del job; registra cuántas claves caducó cada regla. */
export async function processAccessKeyExpiry(
  store: ExpiryStore,
  now: Date = new Date(),
): Promise<ExpirySweepResult> {
  const result = await expireAccessKeys(store, now);
  const total = result.hoursAfterStart + result.onSessionEnd + result.onGroupComplete;
  if (total > 0) logger.info({ ...result }, "access-key expiry: claves caducadas");
  return result;
}

export type AccessKeyExpiryWorkerOptions = {
  store: ExpiryStore;
  /** Conexión dedicada de worker (`createQueueRedis()`); bloquea en BRPOPLPUSH. */
  connection: Redis;
  everyMs?: number;
};

/**
 * Crea el `Worker` y registra (o actualiza) el scheduler repetitivo. Devuelve
 * ambos para que el arranque los cierre en el apagado.
 */
export async function createAccessKeyExpiryWorker(
  opts: AccessKeyExpiryWorkerOptions,
): Promise<{ worker: Worker; queue: Queue }> {
  return createScheduledWorker({
    name: "access-key expiry",
    schedulerId: ACCESS_KEY_EXPIRY_SCHEDULER_ID,
    jobName: "sweep",
    repeat: { every: opts.everyMs ?? DEFAULT_ACCESS_KEY_EXPIRY_EVERY_MS },
    connection: opts.connection,
    queueName: ACCESS_KEY_EXPIRY_QUEUE_NAME,
    process: () => processAccessKeyExpiry(opts.store),
  });
}
