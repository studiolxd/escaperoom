import type { Queue, Worker } from "bullmq";
import type Redis from "ioredis";
import { logger } from "@escaperoom/kit/logger";
import {
  sweepIpUaRetention,
  type IpUaPurgeStore,
  type IpUaPurgeSweepResult,
} from "@escaperoom/shared/services";
import { createScheduledWorker } from "./scheduled-worker";

/**
 * Job de purga de IP/user-agent (specs/18 §4.1): a los 90 días se sustituyen
 * por su hash en `session` (Better Auth) y `termsAcceptance`; a los 2 años se
 * borra la fila entera. Igual que `access-key-email-purge.ts`: un scheduler
 * de BullMQ encola una pasada cada `everyMs`, y cada pasada es idempotente
 * (UPDATE/DELETE por condición, no por id), así que solaparse o repetir una
 * pasada es inocuo. Una sola cola cubre ambos modelos: son la misma
 * operación (hash + borrado por antigüedad) repetida sobre dos tablas.
 */

export const IP_UA_PURGE_QUEUE_NAME = "retention.ip-ua-purge";
/** Id estable del scheduler: reiniciar el worker no duplica la repetición. */
export const IP_UA_PURGE_SCHEDULER_ID = "ip-ua-purge-sweep";
/** Cada hora basta: el plazo más corto es de 90 días. */
export const DEFAULT_IP_UA_PURGE_EVERY_MS = 3_600_000;

export type IpUaPurgeStores = { session: IpUaPurgeStore; termsAcceptance: IpUaPurgeStore };
export type IpUaPurgeResult = { session: IpUaPurgeSweepResult; termsAcceptance: IpUaPurgeSweepResult };

/** Una pasada del job; registra cuántas filas hasheó y borró por modelo. */
export async function processIpUaPurge(
  stores: IpUaPurgeStores,
  secret: string,
  now: Date = new Date(),
): Promise<IpUaPurgeResult> {
  const session = await sweepIpUaRetention(stores.session, now, secret);
  const termsAcceptance = await sweepIpUaRetention(stores.termsAcceptance, now, secret);
  const total = session.hashed + session.deleted + termsAcceptance.hashed + termsAcceptance.deleted;
  if (total > 0) {
    logger.info({ session, termsAcceptance }, "ip/user-agent purge: filas hasheadas o borradas");
  }
  return { session, termsAcceptance };
}

export type IpUaPurgeWorkerOptions = {
  stores: IpUaPurgeStores;
  /** Deriva la clave de hash (HMAC-SHA256); ver `readIpUaPurgeSecret`. */
  secret: string;
  /** Conexión dedicada de worker (`createQueueRedis()`); bloquea en BRPOPLPUSH. */
  connection: Redis;
  everyMs?: number;
};

/**
 * Crea el `Worker` y registra (o actualiza) el scheduler repetitivo. Devuelve
 * ambos para que el arranque los cierre en el apagado.
 */
export async function createIpUaPurgeWorker(
  opts: IpUaPurgeWorkerOptions,
): Promise<{ worker: Worker; queue: Queue }> {
  return createScheduledWorker({
    name: "ip/user-agent purge",
    schedulerId: IP_UA_PURGE_SCHEDULER_ID,
    jobName: "sweep",
    repeat: { every: opts.everyMs ?? DEFAULT_IP_UA_PURGE_EVERY_MS },
    connection: opts.connection,
    queueName: IP_UA_PURGE_QUEUE_NAME,
    process: () => processIpUaPurge(opts.stores, opts.secret),
  });
}
