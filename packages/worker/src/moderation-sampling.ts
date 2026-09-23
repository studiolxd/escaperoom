import { Queue, Worker } from "bullmq";
import type Redis from "ioredis";
import { asBullConnection, queuePrefix } from "@escaperoom/kit/queue";
import { logger } from "@escaperoom/kit/logger";
import type { ModerationService, SamplingResult } from "@escaperoom/shared/services";

/**
 * Muestreo aleatorio de contenido publicado (ticket 6.1, specs/17 §1 y §9). Un
 * scheduler de BullMQ lanza una pasada al día: de las versiones publicadas en
 * los últimos días que aún no se han muestreado, encola en la cola humana la
 * fracción `rate` (100 % en la beta cerrada, decreciente al crecer). Repetir
 * una pasada es inocuo: lo ya muestreado no se vuelve a encolar.
 */

export const MODERATION_SAMPLING_QUEUE_NAME = "moderation.sampling";
/** Id estable del scheduler: reiniciar el worker no duplica la repetición. */
export const MODERATION_SAMPLING_SCHEDULER_ID = "moderation-sampling-daily";
/** Cada día a las 06:00 UTC. */
export const DEFAULT_MODERATION_SAMPLING_CRON = "0 6 * * *";

/** `MODERATION_SAMPLING_RATE` (0–1, por defecto 1 = 100 %); un valor no numérico cae en 1. */
export function readSamplingRate(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MODERATION_SAMPLING_RATE?.trim();
  const value = raw ? Number(raw) : 1;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

type Sampler = Pick<ModerationService, "sampleRecentlyPublished">;

/** Una pasada del job; registra cuántas versiones encoló. */
export async function processModerationSampling(
  moderation: Sampler,
  rate: number,
): Promise<SamplingResult> {
  const result = await moderation.sampleRecentlyPublished({ rate });
  if (result.enqueued > 0) {
    logger.info({ ...result, rate }, "moderation sampling: versiones encoladas para revisión");
  }
  return result;
}

export type ModerationSamplingWorkerOptions = {
  moderation: Sampler;
  /** Conexión dedicada de worker (`createQueueRedis()`); bloquea en BRPOPLPUSH. */
  connection: Redis;
  rate?: number;
  cron?: string;
};

/** Crea el `Worker` y registra (o actualiza) el scheduler diario. */
export async function createModerationSamplingWorker(
  opts: ModerationSamplingWorkerOptions,
): Promise<{ worker: Worker; queue: Queue }> {
  const connection = asBullConnection(opts.connection);
  const rate = opts.rate ?? readSamplingRate();
  const queue = new Queue(MODERATION_SAMPLING_QUEUE_NAME, { connection, prefix: queuePrefix() });
  await queue.upsertJobScheduler(
    MODERATION_SAMPLING_SCHEDULER_ID,
    { pattern: opts.cron ?? DEFAULT_MODERATION_SAMPLING_CRON, tz: "UTC" },
    { name: "sample", opts: { removeOnComplete: 50, removeOnFail: 200 } },
  );

  const worker = new Worker(
    MODERATION_SAMPLING_QUEUE_NAME,
    async () => {
      await processModerationSampling(opts.moderation, rate);
    },
    { connection, prefix: queuePrefix(), concurrency: 1 },
  );
  worker.on("failed", (job, err) => {
    logger.warn({ err, jobId: job?.id }, "moderation sampling: la pasada falló");
  });
  worker.on("error", (err) => {
    logger.warn({ err }, "moderation sampling: error de conexión");
  });
  return { worker, queue };
}
