import type { Queue, Worker } from "bullmq";
import type Redis from "ioredis";
import { logger } from "@escaperoom/kit/logger";
import {
  purgeAccessKeyEmails,
  type AccessKeyEmailPurgeStore,
  type EmailPurgeSweepResult,
} from "@escaperoom/shared/services";
import { createScheduledWorker } from "./scheduled-worker";

/**
 * Job de purga (hash) del email de participante en `accessKey` pasado el
 * plazo de retención (specs/18 §4.1, PR #109): 12 meses tras la finalización
 * del evento en general, 3 meses en eventos `audience: educational`. Igual
 * que `access-key-expiry.ts`: un scheduler de BullMQ encola una pasada cada
 * `everyMs`, y cada pasada es un UPDATE idempotente (un email ya purgado no
 * se vuelve a hashear), así que solaparse o repetir una pasada es inocuo.
 */

export const ACCESS_KEY_EMAIL_PURGE_QUEUE_NAME = "access-keys.email-purge";
/** Id estable del scheduler: reiniciar el worker no duplica la repetición. */
export const ACCESS_KEY_EMAIL_PURGE_SCHEDULER_ID = "access-keys-email-purge-sweep";
/** Cada hora basta: el plazo más corto es de meses. */
export const DEFAULT_ACCESS_KEY_EMAIL_PURGE_EVERY_MS = 3_600_000;

/** Una pasada del job; registra cuántos emails purgó por audiencia. */
export async function processAccessKeyEmailPurge(
  store: AccessKeyEmailPurgeStore,
  secret: string,
  now: Date = new Date(),
): Promise<EmailPurgeSweepResult> {
  const result = await purgeAccessKeyEmails(store, now, secret);
  const total = result.general + result.educational;
  if (total > 0) logger.info({ ...result }, "access-key email purge: emails sustituidos por hash");
  return result;
}

export type AccessKeyEmailPurgeWorkerOptions = {
  store: AccessKeyEmailPurgeStore;
  /** Deriva la clave de hash (HMAC-SHA256); ver `readEmailPurgeSecret`. */
  secret: string;
  /** Conexión dedicada de worker (`createQueueRedis()`); bloquea en BRPOPLPUSH. */
  connection: Redis;
  everyMs?: number;
};

/**
 * Crea el `Worker` y registra (o actualiza) el scheduler repetitivo. Devuelve
 * ambos para que el arranque los cierre en el apagado.
 */
export async function createAccessKeyEmailPurgeWorker(
  opts: AccessKeyEmailPurgeWorkerOptions,
): Promise<{ worker: Worker; queue: Queue }> {
  return createScheduledWorker({
    name: "access-key email purge",
    schedulerId: ACCESS_KEY_EMAIL_PURGE_SCHEDULER_ID,
    jobName: "sweep",
    repeat: { every: opts.everyMs ?? DEFAULT_ACCESS_KEY_EMAIL_PURGE_EVERY_MS },
    connection: opts.connection,
    queueName: ACCESS_KEY_EMAIL_PURGE_QUEUE_NAME,
    process: () => processAccessKeyEmailPurge(opts.store, opts.secret),
  });
}
