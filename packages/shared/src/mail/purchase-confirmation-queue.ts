import {
  createDefineQueue,
  readQueuesRuntimeConfig,
  type QueueDefinition,
  type QueueHandle,
  type QueuesRuntimeConfig,
} from "@escaperoom/kit/queue";
import type { PurchaseConfirmationKind } from "./purchase-confirmation-templates";

/**
 * Cola del email de confirmación de compra (specs/18 §3-4). El webhook de
 * Stripe encola un job por compra confirmada (`checkout.session.completed`)
 * y el worker de `@escaperoom/worker` lo entrega con el transporte
 * configurado, siguiendo el mismo mecanismo que `mail.invitation` (ticket
 * 5.6).
 *
 * El payload lleva **solo** el tipo de compra y su id: el comprador, el
 * idioma y el detalle (título, importe) se leen de Postgres al enviar, así
 * Redis no guarda direcciones de correo (minimización, specs/18 §3).
 */

export const PURCHASE_CONFIRMATION_EMAIL_QUEUE_NAME = "mail.purchase-confirmation";

export type PurchaseConfirmationEmailJob =
  | { kind: "room" | "room_license"; purchaseId: string }
  | { kind: "event_credits"; eventId: string };

type JobsOptions = NonNullable<QueueDefinition<PurchaseConfirmationEmailJob>["defaultJobOptions"]>;

/** Mismos reintentos que `mail.invitation`: 5 intentos, backoff exponencial desde 30 s. */
export const PURCHASE_CONFIRMATION_EMAIL_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/** Handle de la cola (con `QUEUES_ENABLED=false`, `enqueue` es un no-op que devuelve `null`). */
export function createPurchaseConfirmationEmailQueue(
  config: QueuesRuntimeConfig = readQueuesRuntimeConfig(),
): QueueHandle<PurchaseConfirmationEmailJob> {
  return createDefineQueue(config)<PurchaseConfirmationEmailJob>({
    name: PURCHASE_CONFIRMATION_EMAIL_QUEUE_NAME,
    defaultJobOptions: PURCHASE_CONFIRMATION_EMAIL_JOB_OPTIONS,
  });
}

export type { PurchaseConfirmationKind };
