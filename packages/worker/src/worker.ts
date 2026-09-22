import { Worker } from "bullmq";
import type Redis from "ioredis";
import { asBullConnection, queuePrefix } from "@escaperoom/kit/queue";
import { logger } from "@escaperoom/kit/logger";
import { ANALYTICS_QUEUE_NAME, type AnalyticsEventInput } from "@escaperoom/shared/analytics";

/**
 * Worker de la cola de analítica (specs/16 §1): consume cada evento encolado y
 * lo inserta en `analyticsEvent` (specs/14 §8). Es la única pieza que toca la
 * base de datos, de modo que la request de colección nunca espera a la escritura.
 */

/** Fila que el worker escribe en `analyticsEvent`. */
export type AnalyticsEventCreateData = {
  eventType: string;
  sessionId: string | null;
  playerId: string | null;
  roomVersionId: string | null;
  payload: Record<string, unknown>;
};

/**
 * Superficie mínima del delegate de Prisma que el worker necesita. Estructural,
 * para poder testear el procesador sin base de datos; en producción se le pasa
 * `prisma.analyticsEvent` (ver `src/main.ts`).
 */
export interface AnalyticsEventStore {
  create(args: { data: AnalyticsEventCreateData }): Promise<unknown>;
}

/** Mapea un evento validado a una fila de `analyticsEvent` y la inserta. */
export async function processAnalyticsEvent(
  store: AnalyticsEventStore,
  event: AnalyticsEventInput,
): Promise<void> {
  await store.create({
    data: {
      eventType: event.eventType,
      sessionId: event.sessionId ?? null,
      playerId: event.playerId ?? null,
      roomVersionId: event.roomVersionId ?? null,
      payload: event.payload ?? {},
    },
  });
}

export type AnalyticsWorkerOptions = {
  store: AnalyticsEventStore;
  /** Conexión dedicada de worker (`createQueueRedis()`); bloquea en BRPOPLPUSH. */
  connection: Redis;
  queueName?: string;
  concurrency?: number;
};

/**
 * Crea el `Worker` de BullMQ. La conexión la inyecta el arranque (o el test de
 * integración) para no acoplarse a `process.env` en el constructor.
 */
export function createAnalyticsWorker(opts: AnalyticsWorkerOptions): Worker<AnalyticsEventInput> {
  const worker = new Worker<AnalyticsEventInput>(
    opts.queueName ?? ANALYTICS_QUEUE_NAME,
    async (job) => {
      await processAnalyticsEvent(opts.store, job.data);
    },
    {
      connection: asBullConnection(opts.connection),
      prefix: queuePrefix(),
      concurrency: opts.concurrency ?? 20,
    },
  );

  worker.on("failed", (job, err) => {
    logger.warn(
      { err, jobId: job?.id, eventType: job?.data?.eventType },
      "analytics worker: el job falló",
    );
  });
  worker.on("error", (err) => {
    logger.warn({ err }, "analytics worker: error de conexión");
  });

  return worker;
}
