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
  createMany(args: { data: AnalyticsEventCreateData[] }): Promise<unknown>;
}

function toCreateData(event: AnalyticsEventInput): AnalyticsEventCreateData {
  return {
    eventType: event.eventType,
    sessionId: event.sessionId ?? null,
    playerId: event.playerId ?? null,
    roomVersionId: event.roomVersionId ?? null,
    payload: event.payload ?? {},
  };
}

/** Mapea un evento validado a una fila de `analyticsEvent` y la inserta (una a una). */
export async function processAnalyticsEvent(
  store: Pick<AnalyticsEventStore, "create">,
  event: AnalyticsEventInput,
): Promise<void> {
  await store.create({ data: toCreateData(event) });
}

export type AnalyticsEventBatcher = {
  /** Encola el evento y no resuelve hasta que SU lote se escribió (o falló). */
  add(event: AnalyticsEventInput): Promise<void>;
  /** Vuelca el lote pendiente ya mismo (cierre del worker). */
  flush(): Promise<void>;
  pendingCount(): number;
};

/**
 * E-23: agrupa los `INSERT` individuales (uno por job, con concurrencia 20)
 * en `createMany` por lotes — se vuelca al llegar a `maxBatchSize` o pasados
 * `maxWaitMs` desde el primer evento del lote, lo que ocurra antes, para no
 * hacer esperar a la analítica con poco tráfico. `add()` no resuelve hasta
 * que su lote se escribe: BullMQ no confirma (`ack`) el job del worker hasta
 * entonces, así que un `createMany` que falla solo reintenta esos jobs.
 */
export function createAnalyticsEventBatcher(
  store: Pick<AnalyticsEventStore, "createMany">,
  opts: { maxBatchSize?: number; maxWaitMs?: number } = {},
): AnalyticsEventBatcher {
  const maxBatchSize = opts.maxBatchSize ?? 100;
  const maxWaitMs = opts.maxWaitMs ?? 200;
  type Pending = {
    data: AnalyticsEventCreateData;
    resolve: () => void;
    reject: (err: unknown) => void;
  };
  let pending: Pending[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    try {
      await store.createMany({ data: batch.map((p) => p.data) });
      for (const p of batch) p.resolve();
    } catch (err) {
      for (const p of batch) p.reject(err);
    }
  }

  function add(event: AnalyticsEventInput): Promise<void> {
    return new Promise((resolve, reject) => {
      pending.push({ data: toCreateData(event), resolve, reject });
      if (pending.length >= maxBatchSize) {
        void flush();
      } else if (!timer) {
        timer = setTimeout(() => void flush(), maxWaitMs);
      }
    });
  }

  return { add, flush, pendingCount: () => pending.length };
}

export type AnalyticsWorkerOptions = {
  store: AnalyticsEventStore;
  /** Conexión dedicada de worker (`createQueueRedis()`); bloquea en BRPOPLPUSH. */
  connection: Redis;
  queueName?: string;
  concurrency?: number;
  /** E-23: tamaño y espera máxima del lote antes de `createMany`. */
  batchSize?: number;
  batchWaitMs?: number;
};

/**
 * Crea el `Worker` de BullMQ. La conexión la inyecta el arranque (o el test de
 * integración) para no acoplarse a `process.env` en el constructor.
 */
export function createAnalyticsWorker(opts: AnalyticsWorkerOptions): Worker<AnalyticsEventInput> {
  const batcher = createAnalyticsEventBatcher(opts.store, {
    maxBatchSize: opts.batchSize,
    maxWaitMs: opts.batchWaitMs,
  });
  const worker = new Worker<AnalyticsEventInput>(
    opts.queueName ?? ANALYTICS_QUEUE_NAME,
    async (job) => {
      await batcher.add(job.data);
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
