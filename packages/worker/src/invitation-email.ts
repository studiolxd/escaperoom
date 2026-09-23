import { Worker, type Job } from "bullmq";
import type Redis from "ioredis";
import { asBullConnection, queuePrefix } from "@escaperoom/kit/queue";
import { logger } from "@escaperoom/kit/logger";
import { INVITATION_EMAIL_QUEUE_NAME, type InvitationEmailJob } from "@escaperoom/shared/mail";
import {
  deliverInvitationEmail,
  type DeliveryResult,
  type InvitationDeliveryDeps,
} from "@escaperoom/shared/services";

/**
 * Worker de envíos de invitación (ticket 5.6). Consume `mail.invitation`: cada
 * job es una clave; `deliverInvitationEmail` la relee de Postgres, renderiza la
 * plantilla en el idioma del evento y la entrega con el transporte configurado
 * (Nodemailer/SMTP por defecto, Resend opcional).
 *
 * Un fallo del transporte hace fallar el job y BullMQ lo reintenta con las
 * opciones de la cola (`INVITATION_EMAIL_JOB_OPTIONS`: 5 intentos, backoff
 * exponencial). Los registros no llevan ni la dirección ni la clave: solo el
 * id del job y el intento.
 */

/** Procesador del job, separado del `Worker` para testearlo sin Redis. */
export function createInvitationEmailProcessor(deps: InvitationDeliveryDeps) {
  return async function processInvitationEmail(
    job: Pick<Job<InvitationEmailJob>, "data" | "id" | "attemptsMade">,
  ): Promise<DeliveryResult> {
    const result = await deliverInvitationEmail(deps, job.data);
    if (result.status === "skipped") {
      logger.info(
        { jobId: job.id, kind: job.data.kind, reason: result.reason },
        "invitation email: omitido",
      );
    }
    return result;
  };
}

export type InvitationEmailWorkerOptions = {
  deps: InvitationDeliveryDeps;
  /** Conexión dedicada de worker (`createQueueRedis()`). */
  connection: Redis;
  queueName?: string;
  /** Envíos en paralelo; bajo para no disparar los límites del SMTP/Resend. */
  concurrency?: number;
};

export function createInvitationEmailWorker(
  opts: InvitationEmailWorkerOptions,
): Worker<InvitationEmailJob, DeliveryResult> {
  const worker = new Worker<InvitationEmailJob, DeliveryResult>(
    opts.queueName ?? INVITATION_EMAIL_QUEUE_NAME,
    createInvitationEmailProcessor(opts.deps),
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
        ? "invitation email: agotados los reintentos"
        : "invitation email: fallo, se reintentará",
    );
  });
  worker.on("error", (err) => {
    logger.warn({ err }, "invitation email: error de conexión");
  });
  return worker;
}
