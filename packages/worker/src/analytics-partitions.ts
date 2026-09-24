import type { Queue, Worker } from "bullmq";
import type Redis from "ioredis";
import { logger } from "@escaperoom/kit/logger";
import { createScheduledWorker } from "./scheduled-worker";
import {
  maintainAnalyticsPartitions,
  type PartitionMaintenanceDb,
  type PartitionMaintenanceOptions,
  type PartitionMaintenanceResult,
} from "@escaperoom/shared/analytics";

/**
 * Job mensual de particiones de `analyticsEvent` (ticket 6.11, specs/14 §8 y
 * §12): crea por adelantado la partición del mes siguiente y purga las que
 * superan los 24 meses de retención.
 *
 * Seguro ante reintentos y ante varios workers: el scheduler tiene id estable
 * (un solo job por repetición aunque arranquen varios procesos), cada pasada
 * es idempotente (`CREATE … IF NOT EXISTS`, solo purga lo que aún existe) y va
 * dentro de un advisory lock de Postgres; si otra pasada lo tiene, se omite.
 */

export const ANALYTICS_PARTITIONS_QUEUE_NAME = "analytics.partitions";
/** Id estable del scheduler: reiniciar el worker no duplica la repetición. */
export const ANALYTICS_PARTITIONS_SCHEDULER_ID = "analytics-partitions-monthly";
/** Día 1 de cada mes a las 03:00 UTC: la del mes siguiente queda creada con un mes de margen. */
export const DEFAULT_ANALYTICS_PARTITIONS_CRON = "0 3 1 * *";

/** Una pasada; registra el resultado (es la métrica del job). */
export async function processAnalyticsPartitions(
  db: PartitionMaintenanceDb,
  opts: PartitionMaintenanceOptions = {},
): Promise<PartitionMaintenanceResult> {
  const startedAt = Date.now();
  const result = await maintainAnalyticsPartitions(db, opts);
  const durationMs = Date.now() - startedAt;

  if (result.status === "locked") {
    logger.info({ durationMs }, "analytics partitions: otra pasada tiene el lock; se omite");
    return result;
  }
  logger.info(
    {
      created: result.created,
      dropped: result.dropped,
      createdCount: result.created.length,
      droppedCount: result.dropped.length,
      cutoff: result.cutoff,
      durationMs,
    },
    "analytics partitions: mantenimiento hecho",
  );
  if (result.ignored.length > 0) {
    logger.warn(
      { ignored: result.ignored },
      "analytics partitions: particiones fuera del patrón mensual; no se tocan",
    );
  }
  if (result.defaultPartitionHasRows) {
    // E-6: la partición DEFAULT solo debería recibir filas si algún INSERT
    // cayó fuera de las particiones mensuales esperadas (reloj desincronizado,
    // evento con createdAt manipulado, bug de rango) — nunca en operación
    // normal. Merece alertar, no solo un aviso silencioso en el log.
    logger.error(
      { partition: "analyticsEvent_default" },
      "analytics partitions: la partición DEFAULT tiene filas — algún INSERT cayó fuera de las particiones mensuales esperadas",
    );
  }
  return result;
}

export type AnalyticsPartitionsWorkerOptions = {
  db: PartitionMaintenanceDb;
  /** Conexión dedicada de worker (`createQueueRedis()`); bloquea en BRPOPLPUSH. */
  connection: Redis;
  queueName?: string;
  /** Cron (UTC) del scheduler. */
  pattern?: string;
  /**
   * Encola además una pasada al arrancar (deduplicada por día): si el worker
   * estuvo caído el día 1, la partición del mes siguiente no se queda sin crear.
   */
  runOnStart?: boolean;
  now?: () => Date;
};

const JOB_OPTS = {
  // E-6: antes 3 — con lock_timeout de 10s (SET LOCAL en la transacción) un
  // día de mucha escritura puede agotar varios intentos seguidos; más
  // intentos con backoff exponencial dan más margen antes de depender solo
  // de la siguiente repetición mensual (o de `runOnStartJobId`).
  attempts: 8,
  backoff: { type: "exponential" as const, delay: 60_000 },
  removeOnComplete: 24,
  removeOnFail: 100,
};

/**
 * Crea el `Worker` y registra (o actualiza) el scheduler mensual. Devuelve
 * ambos para que el arranque los cierre en el apagado.
 */
export async function createAnalyticsPartitionsWorker(
  opts: AnalyticsPartitionsWorkerOptions,
): Promise<{ worker: Worker; queue: Queue }> {
  const day = (opts.now?.() ?? new Date()).toISOString().slice(0, 10);
  return createScheduledWorker({
    name: "analytics partitions",
    schedulerId: ANALYTICS_PARTITIONS_SCHEDULER_ID,
    jobName: "maintain",
    repeat: { pattern: opts.pattern ?? DEFAULT_ANALYTICS_PARTITIONS_CRON },
    connection: opts.connection,
    queueName: opts.queueName ?? ANALYTICS_PARTITIONS_QUEUE_NAME,
    jobOptions: JOB_OPTS,
    // jobId por día: varios workers arrancando el mismo día encolan una sola
    // pasada (si el worker estuvo caído justo el día 1, no se queda sin
    // partición del mes siguiente hasta la próxima repetición mensual).
    runOnStartJobId: (opts.runOnStart ?? true) ? `boot-${day}` : undefined,
    process: () => processAnalyticsPartitions(opts.db, { now: opts.now?.() }),
  });
}
