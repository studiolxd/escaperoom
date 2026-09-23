import {
  renderPurchaseConfirmationEmail,
  resolveMailLocale,
  type PurchaseConfirmationEmailJob,
  type MailTransport,
} from "../mail";

/**
 * Entrega del email de confirmación de compra (specs/18 §3-4, ticket 5.1/5.4/
 * 5.10 + este hueco legal). El webhook de Stripe encola un job en
 * `mail.purchase-confirmation` tras `checkout.session.completed` (una vez
 * liquidada la compra) y el worker lo entrega con `deliverPurchaseConfirmationEmail`,
 * siguiendo el MISMO mecanismo que las invitaciones (ticket 5.6): el job solo
 * lleva el tipo y el id, y el comprador, su idioma y el detalle de la compra
 * se releen de Postgres en el momento del envío.
 */

/** Lo que el email necesita de la compra, resuelto en el momento del envío. */
export type PurchaseConfirmationDetails = {
  /** Email del comprador (`user.email`) o del organizador (`event_credits`). */
  email: string;
  /** `user.locale` del comprador/organizador. */
  locale: string;
  /** Título de la sala (`room`/`room_license`) o del evento (`event_credits`). */
  itemTitle: string;
  amountCents: number;
  currency: string;
  /** Aforo comprado; solo relevante en `event_credits`. */
  players: number | null;
};

/** Puerto de persistencia (ADR-022): relee la compra/evento por su id en cada envío. */
export interface PurchaseConfirmationStore {
  /** `null` si la compra/evento ya no existe o no está en un estado que justifique el envío. */
  findDetails(job: PurchaseConfirmationEmailJob): Promise<PurchaseConfirmationDetails | null>;
}

/** Cola de envíos (en web, el handle de `createPurchaseConfirmationEmailQueue`). */
export interface PurchaseConfirmationQueue {
  /** Id del job, o `null` si la cola está deshabilitada o Redis cayó. */
  enqueue(job: PurchaseConfirmationEmailJob): Promise<string | null>;
}

export type PurchaseConfirmationDeliveryResult =
  | { status: "sent"; messageId: string }
  | { status: "skipped"; reason: "NOT_FOUND" };

export type PurchaseConfirmationDeliveryDeps = {
  store: PurchaseConfirmationStore;
  transport: MailTransport;
  /** URL pública de la web (`APP_URL`), para el enlace a los Términos de Servicio. */
  appUrl: string;
};

function jobRef(job: PurchaseConfirmationEmailJob): string {
  return job.kind === "event_credits" ? job.eventId : job.purchaseId;
}

function termsUrl(appUrl: string, locale: string): string {
  return `${appUrl.replace(/\/+$/, "")}/${locale}/legal/terms`;
}

/**
 * Procesa un job de `mail.purchase-confirmation`: relee la compra/evento en el
 * momento del envío, renderiza la plantilla en el idioma del comprador y la
 * entrega. Un fallo del transporte se propaga: BullMQ reintenta el job con
 * backoff (mismas opciones que `mail.invitation`).
 */
export async function deliverPurchaseConfirmationEmail(
  deps: PurchaseConfirmationDeliveryDeps,
  job: PurchaseConfirmationEmailJob,
): Promise<PurchaseConfirmationDeliveryResult> {
  const details = await deps.store.findDetails(job);
  if (!details) return { status: "skipped", reason: "NOT_FOUND" };

  const locale = resolveMailLocale(details.locale);
  const rendered = renderPurchaseConfirmationEmail({
    locale,
    kind: job.kind,
    itemTitle: details.itemTitle,
    amountCents: details.amountCents,
    currency: details.currency,
    players: job.kind === "event_credits" ? details.players : null,
    termsUrl: termsUrl(deps.appUrl, locale),
  });
  const { messageId } = await deps.transport.send({
    to: details.email,
    ...rendered,
    // Un mensaje por compra: que el cliente no las agrupe en un hilo.
    headers: { "X-Entity-Ref-ID": `purchase-confirmation:${job.kind}:${jobRef(job)}` },
  });
  return { status: "sent", messageId };
}

// ── Implementación en memoria (tests) ───────────────────────────────────────

export function createInMemoryPurchaseConfirmationStore(
  details: Record<string, PurchaseConfirmationDetails>,
): PurchaseConfirmationStore {
  return {
    async findDetails(job) {
      return details[`${job.kind}:${jobRef(job)}`] ?? null;
    },
  };
}
