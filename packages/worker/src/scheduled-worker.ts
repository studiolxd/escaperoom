import { Queue, Worker, type JobsOptions } from "bullmq";
import type Redis from "ioredis";
import { asBullConnection, queuePrefix } from "@escaperoom/kit/queue";
import { logger } from "@escaperoom/kit/logger";

// ---------------------------------------------------------------------------
// E-9: los jobs periódicos del worker (caducidad de claves, purgas de
// email/IP-UA, particiones de analítica, muestreo de moderación) repetían
// casi línea a línea el mismo bloque: crear la Queue, dar de alta (o
// actualizar) un scheduler repetitivo con id estable, crear el Worker que
// procesa una pasada y los dos `worker.on("failed"|"error", …)` de logging.
// Este helper es ese bloque una sola vez; cada job solo aporta su `process`.
// ---------------------------------------------------------------------------

export type ScheduledWorkerRepeat =
  | { every: number; pattern?: never; tz?: never }
  | { pattern: string; every?: never; tz?: string };

export type ScheduledWorkerOptions = {
  /** Nombre de la cola/scheduler; también la etiqueta de los logs. */
  name: string;
  /** Id estable del scheduler: reiniciar el worker no duplica la repetición. */
  schedulerId: string;
  /** Nombre del job BullMQ encolado en cada repetición. */
  jobName: string;
  /** Repetición: cada `every` ms, o cron `pattern` (+ `tz`, por defecto UTC). */
  repeat: ScheduledWorkerRepeat;
  /** Conexión dedicada de worker (`createQueueRedis()`); bloquea en BRPOPLPUSH. */
  connection: Redis;
  /** Una pasada del job. */
  process: () => Promise<unknown>;
  /** Opciones del job repetitivo (removeOnComplete/removeOnFail, attempts, backoff…). */
  jobOptions?: JobsOptions;
  /**
   * Además del scheduler, encola una pasada al arrancar con este `jobId`
   * (debe ser estable/dedupeable, p. ej. por fecha) — para que un worker que
   * estuvo caído justo en la repetición anterior no se quede sin pasada hasta
   * la siguiente.
   */
  runOnStartJobId?: string;
  /** Nombre de la cola en BullMQ, si difiere de `name` (p. ej. para tests). */
  queueName?: string;
};

const DEFAULT_JOB_OPTS: JobsOptions = { removeOnComplete: 100, removeOnFail: 500 };

/**
 * Crea el `Worker` y registra (o actualiza) el scheduler repetitivo de un job
 * periódico. Devuelve `{ worker, queue }` para que el arranque los cierre en
 * el apagado, igual que hacían los `create*Worker` de cada job.
 */
export async function createScheduledWorker(
  opts: ScheduledWorkerOptions,
): Promise<{ worker: Worker; queue: Queue }> {
  const connection = asBullConnection(opts.connection);
  const queueName = opts.queueName ?? opts.name;
  const jobOptions = opts.jobOptions ?? DEFAULT_JOB_OPTS;
  const queue = new Queue(queueName, { connection, prefix: queuePrefix() });

  const repeat =
    "pattern" in opts.repeat && opts.repeat.pattern
      ? { pattern: opts.repeat.pattern, tz: opts.repeat.tz ?? "UTC" }
      : { every: (opts.repeat as { every: number }).every };
  await queue.upsertJobScheduler(opts.schedulerId, repeat, { name: opts.jobName, opts: jobOptions });

  if (opts.runOnStartJobId) {
    await queue.add(opts.jobName, {}, { ...jobOptions, jobId: opts.runOnStartJobId });
  }

  const worker = new Worker(
    queueName,
    async () => {
      await opts.process();
    },
    // Una pasada a la vez por proceso: cada job es idempotente y/o usa su
    // propio lock (advisory lock de Postgres en particiones) entre procesos.
    { connection, prefix: queuePrefix(), concurrency: 1 },
  );
  worker.on("failed", (job, err) => {
    logger.warn(
      { err, jobId: job?.id, attemptsMade: job?.attemptsMade },
      `${opts.name}: la pasada falló`,
    );
  });
  worker.on("error", (err) => {
    logger.warn({ err }, `${opts.name}: error de conexión`);
  });

  return { worker, queue };
}
