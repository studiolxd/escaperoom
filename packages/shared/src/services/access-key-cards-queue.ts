import {
  createDefineQueue,
  readQueuesRuntimeConfig,
  type QueueHandle,
  type QueuesRuntimeConfig,
} from "@escaperoom/kit/queue";
import type {
  CardExportJob,
  CardExportJobData,
  CardExportJobStatus,
  CardExportQueue,
  CardExportResult,
} from "./access-key-cards";
import { EXPORT_DOWNLOAD_TTL_MS } from "./access-key-cards";

/**
 * Cola BullMQ del export de tarjetas (ticket 5.7). Web encola; el worker de
 * `@escaperoom/worker` consume. Cola propia (no se mezcla con la de emails de
 * 5.6 ni con la analítica). Subpath aparte (`@escaperoom/shared/access-key-cards-queue`)
 * para que importar los servicios no arrastre BullMQ.
 */

export const ACCESS_KEY_CARDS_QUEUE_NAME = "access-keys.cards-pdf";

/** El job (y con él su estado) vive lo que la URL de descarga y un día de margen. */
const RETENTION_SECONDS = Math.ceil((EXPORT_DOWNLOAD_TTL_MS * 2) / 1000);

/** Handle tipado de la cola, atado a `QUEUES_ENABLED` salvo config explícita. */
export function createAccessKeyCardsQueueHandle(
  config: QueuesRuntimeConfig = readQueuesRuntimeConfig(),
): QueueHandle<CardExportJobData> {
  return createDefineQueue(config)<CardExportJobData>({
    name: ACCESS_KEY_CARDS_QUEUE_NAME,
    defaultJobOptions: {
      removeOnComplete: { age: RETENTION_SECONDS },
      removeOnFail: { age: RETENTION_SECONDS },
    },
  });
}

const STATUS_BY_STATE: Record<string, CardExportJobStatus> = {
  waiting: "queued",
  delayed: "queued",
  prioritized: "queued",
  "waiting-children": "queued",
  active: "processing",
  completed: "completed",
  failed: "failed",
};

/** Adaptador del puerto `CardExportQueue` sobre el handle de BullMQ. */
export function createBullCardExportQueue(
  handle: QueueHandle<CardExportJobData> = createAccessKeyCardsQueueHandle(),
): CardExportQueue {
  return {
    async enqueue(jobId, data) {
      return (await handle.enqueue(data, { jobId })) !== null;
    },
    async find(jobId) {
      const queue = handle.getQueue();
      if (!queue) return null;
      // Primero el estado y luego el hash: al revés, un job que termina entre
      // las dos lecturas saldría `completed` sin `returnvalue` ni `finishedOn`.
      const status = STATUS_BY_STATE[await queue.getJobState(jobId)];
      const job = status ? await queue.getJob(jobId) : undefined;
      if (!status || !job?.id) return null;
      const result = status === "completed" ? (job.returnvalue as CardExportResult | null) : null;
      const view: CardExportJob = {
        id: job.id,
        // Terminado pero aún sin resultado visible: se informa como en curso.
        status: status === "completed" && !result ? "processing" : status,
        data: job.data,
        result,
        finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
      };
      return view;
    },
  };
}
