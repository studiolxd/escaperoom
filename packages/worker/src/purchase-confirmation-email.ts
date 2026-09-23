import { Worker, type Job } from "bullmq";
import type Redis from "ioredis";
import { asBullConnection, queuePrefix } from "@escaperoom/kit/queue";
import { logger } from "@escaperoom/kit/logger";
import {
  PURCHASE_CONFIRMATION_EMAIL_QUEUE_NAME,
  type PurchaseConfirmationEmailJob,
} from "@escaperoom/shared/mail";
import {
  deliverPurchaseConfirmationEmail,
  type PurchaseConfirmationDeliveryDeps,
  type PurchaseConfirmationDeliveryResult,
} from "@escaperoom/shared/services";

/**
 * Worker del email de confirmación de compra (specs/18 §3-4). Consume
 * `mail.purchase-confirmation`: cada job es una compra o un evento pagado;
 * `deliverPurchaseConfirmationEmail` la relee de Postgres, renderiza la
 * plantilla en el idioma del comprador y la entrega con el transporte
 * configurado. Mismo mecanismo que el worker de invitaciones (ticket 5.6).
 *
 * Un fallo del transporte hace fallar el job y BullMQ lo reintenta con las
 * opciones de la cola (`PURCHASE_CONFIRMATION_EMAIL_JOB_OPTIONS`: 5 intentos,
 * backoff exponencial). Los registros no llevan la dirección del comprador.
 */

/** Procesador del job, separado del `Worker` para testearlo sin Redis. */
export function createPurchaseConfirmationEmailProcessor(deps: PurchaseConfirmationDeliveryDeps) {
  return async function processPurchaseConfirmationEmail(
    job: Pick<Job<PurchaseConfirmationEmailJob>, "data" | "id" | "attemptsMade">,
  ): Promise<PurchaseConfirmationDeliveryResult> {
    const result = await deliverPurchaseConfirmationEmail(deps, job.data);
    if (result.status === "skipped") {
      logger.info(
        { jobId: job.id, kind: job.data.kind, reason: result.reason },
        "purchase confirmation email: omitido",
      );
    }
    return result;
  };
}

export type PurchaseConfirmationEmailWorkerOptions = {
  deps: PurchaseConfirmationDeliveryDeps;
  /** Conexión dedicada de worker (`createQueueRedis()`). */
  connection: Redis;
  queueName?: string;
  /** Envíos en paralelo; bajo para no disparar los límites del SMTP/Resend. */
  concurrency?: number;
};

export function createPurchaseConfirmationEmailWorker(
  opts: PurchaseConfirmationEmailWorkerOptions,
): Worker<PurchaseConfirmationEmailJob, PurchaseConfirmationDeliveryResult> {
  const worker = new Worker<PurchaseConfirmationEmailJob, PurchaseConfirmationDeliveryResult>(
    opts.queueName ?? PURCHASE_CONFIRMATION_EMAIL_QUEUE_NAME,
    createPurchaseConfirmationEmailProcessor(opts.deps),
    {
      connection: asBullConnection(opts.connection),
      prefix: queuePrefix(),
      concurrency: opts.concurrency ?? 5,
    },
  );
  worker.on("failed", (job, err) => {
    const attempts = job?.opts.attempts ?? 1;
    const final = (job?.attemptsMade ?? 0) >= attempts;
    logger[final ? "error" : "warn"](
      { err: err.message, jobId: job?.id, attemptsMade: job?.attemptsMade, attempts },
      final
        ? "purchase confirmation email: agotados los reintentos"
        : "purchase confirmation email: fallo, se reintentará",
    );
  });
  worker.on("error", (err) => {
    logger.warn({ err }, "purchase confirmation email: error de conexión");
  });
  return worker;
}
