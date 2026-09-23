import {
  createDefineQueue,
  readQueuesRuntimeConfig,
  type QueueDefinition,
  type QueueHandle,
  type QueuesRuntimeConfig,
} from "@escaperoom/kit/queue";
import type { InvitationEmailKind } from "./templates";

/**
 * Cola de envíos de invitación (ticket 5.6). Web encola un job por clave y el
 * worker de `@escaperoom/worker` lo entrega con el transporte configurado.
 *
 * El payload lleva **solo** el código y el tipo de email: el destinatario, el
 * idioma y los títulos se leen de Postgres al enviar, así Redis no guarda
 * direcciones de correo (minimización, specs/18 §3) y un reenvío tras rotar o
 * caducar la clave no manda datos viejos.
 */

export const INVITATION_EMAIL_QUEUE_NAME = "mail.invitation";

export type InvitationEmailJob = { code: string; kind: InvitationEmailKind };

type JobsOptions = NonNullable<QueueDefinition<InvitationEmailJob>["defaultJobOptions"]>;

/**
 * Reintentos del envío: 5 intentos con backoff exponencial (30 s, 1 min, 2 min,
 * 4 min…) cubren una caída breve del SMTP/Resend sin duplicar a lo loco.
 */
export const INVITATION_EMAIL_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/** Handle de la cola (con `QUEUES_ENABLED=false`, `enqueue` es un no-op que devuelve `null`). */
export function createInvitationEmailQueue(
  config: QueuesRuntimeConfig = readQueuesRuntimeConfig(),
): QueueHandle<InvitationEmailJob> {
  return createDefineQueue(config)<InvitationEmailJob>({
    name: INVITATION_EMAIL_QUEUE_NAME,
    defaultJobOptions: INVITATION_EMAIL_JOB_OPTIONS,
  });
}
