import { UnrecoverableError, Worker, type Job } from "bullmq";
import type Redis from "ioredis";
import { asBullConnection, queuePrefix } from "@escaperoom/kit/queue";
import { logger } from "@escaperoom/kit/logger";
import { ACCESS_KEY_CARDS_QUEUE_NAME } from "@escaperoom/shared/access-key-cards-queue";
import {
  AccessKeyCardsError,
  stripFilterFromJobData,
  type AccessKeyCardsService,
  type CardExportBlobStore,
  type CardExportJobData,
  type CardExportResult,
} from "@escaperoom/shared/services";

/**
 * Job del PDF de tarjetas-clave (ticket 5.7, specs/13 §9). Web encola los
 * exports de 50 tarjetas o más en `access-keys.cards-pdf`; aquí se renderiza el
 * PDF con el mismo servicio de dominio y se sube al bucket privado. El estado y
 * la URL firmada los sirve `GET /api/exports/:jobId`. Cola propia: no comparte
 * worker con los emails (5.6) ni con la analítica.
 */

type CardsProcessor = Pick<AccessKeyCardsService, "runExportJob">;

/**
 * Procesa un job. Un error de dominio (el evento ya no es suyo, la clave ya no
 * existe…) no se arregla reintentando: se marca como irrecuperable. Los fallos
 * de infraestructura (bucket, base de datos) sí se reintentan.
 */
export async function processAccessKeyCardsExport(
  cards: CardsProcessor,
  blobs: Pick<CardExportBlobStore, "put">,
  job: Pick<Job<CardExportJobData, CardExportResult>, "id" | "data" | "updateData">,
): Promise<CardExportResult> {
  const jobId = job.id!;
  const data = job.data;
  try {
    const result = await cards.runExportJob(jobId, data, blobs);
    logger.info({ jobId, eventId: data.eventId, cards: result.cards }, "cards pdf: export listo");
    return result;
  } catch (err) {
    if (err instanceof AccessKeyCardsError) {
      throw new UnrecoverableError(`${err.code}: ${err.message}`);
    }
    throw err;
  } finally {
    // E-8: el job terminado (éxito o fallo) no conserva los códigos
    // solicitados — solo hacía falta transportarlos hasta este punto.
    await job.updateData(stripFilterFromJobData(data));
  }
}

export type AccessKeyCardsWorkerOptions = {
  cards: CardsProcessor;
  blobs: Pick<CardExportBlobStore, "put">;
  /** Conexión dedicada de worker (`createQueueRedis()`); bloquea en BRPOPLPUSH. */
  connection: Redis;
  concurrency?: number;
};

export function createAccessKeyCardsWorker(
  opts: AccessKeyCardsWorkerOptions,
): Worker<CardExportJobData, CardExportResult> {
  const worker = new Worker<CardExportJobData, CardExportResult>(
    ACCESS_KEY_CARDS_QUEUE_NAME,
    async (job) => processAccessKeyCardsExport(opts.cards, opts.blobs, job),
    {
      connection: asBullConnection(opts.connection),
      prefix: queuePrefix(),
      // Renderizar es CPU: pocos a la vez para no bloquear el resto de colas.
      concurrency: opts.concurrency ?? 2,
    },
  );
  worker.on("failed", (job, err) => {
    logger.warn({ err, jobId: job?.id, eventId: job?.data?.eventId }, "cards pdf: el export falló");
  });
  worker.on("error", (err) => {
    logger.warn({ err }, "cards pdf: error de conexión");
  });
  return worker;
}
