import { z } from "zod";
import { toReadableIssues } from "../schemas/errors";
import {
  signConfirmationToken,
  verifyConfirmationToken,
  type ConfirmationTokenConfig,
} from "../mail/confirmation-token";
import type { InvitationEmailJob } from "../mail/queue";
import {
  renderInvitationEmail,
  resolveMailLocale,
  type InvitationEmailKind,
} from "../mail/templates";
import type { MailTransport } from "../mail/transport";
import {
  AccessKeyError,
  isLiveAccessKey,
  normalizeAccessKeyCode,
  type AccessKeyRow,
  type AccessKeyService,
  type AccessKeyStatus,
  type AccessKeyStore,
  type ActivationResult,
} from "./access-keys";
import { type Actor } from "./actor";
import { UUID_RE, requireUser } from "./common";
import type { EventRow } from "./events";

/**
 * Invitaciones por email y confirmación de asistencia (ticket 5.6, specs/02 §4.4,
 * specs/13 §6.2).
 *
 * - **Envío**: generar claves con `emails` encola un job por clave
 *   (`mail.invitation`); el worker lo entrega con `deliverInvitationEmail`
 *   (plantilla en el idioma del evento, reintentos de BullMQ si el transporte
 *   falla). El envío correcto sella `sentAt` y, con confirmación obligatoria,
 *   lleva la clave de `generated` a `pending_confirmation`.
 * - **Confirmación**: el email lleva un enlace firmado (HMAC, caduca); al
 *   confirmar, `pending_confirmation → confirmed` (canjeable). Confirmar dos
 *   veces es idempotente; un enlace manipulado, de otra clave o caducado se
 *   rechaza.
 * - **Reenvío**: una clave (`POST /api/access-keys/:code/resend`) o todas las
 *   pendientes de confirmar de un evento (recordatorio).
 * - **DPA** (5.11): generar, reenviar o recordar exige el DPA vigente de la
 *   organización activa (`DPA_REQUIRED`, vía la puerta de 5.5). El worker no lo
 *   vuelve a comprobar: solo entrega lo que ya se encoló con el DPA en regla.
 * - **Resumen** para el panel: invitadas, enviadas, confirmadas ("28/30").
 */

// ── Puertos ────────────────────────────────────────────────────────────────

/** Lo que el email necesita del evento y que no está en `EventRow`. */
export type InvitationEventExtras = {
  roomTitle: string;
  /** `user.locale` del organizador: idioma por defecto si el evento no fija uno. */
  organizerLocale: string | null;
};

/** Contadores de invitaciones de un evento (claves con email, sin contar las ya rotadas). */
export type InvitationStats = {
  invited: number;
  sent: number;
  confirmed: number;
  /** Aún sin confirmar (`generated`, `sent`, `pending_confirmation`). */
  pending: number;
  /** Caducadas sin haber confirmado. */
  expired: number;
};

/** Puerto de persistencia de invitaciones (ADR-022): claves de 5.5 + lecturas propias. */
export interface InvitationStore extends Pick<
  AccessKeyStore,
  "findEvent" | "findKey" | "updateKey"
> {
  describeEvent(eventId: string): Promise<InvitationEventExtras | null>;
  invitationStats(eventId: string): Promise<InvitationStats>;
  /** Códigos con email en `pending_confirmation` (para el recordatorio masivo). */
  listPendingConfirmation(eventId: string, limit: number): Promise<string[]>;
}

/** Cola de envíos (en web, el handle de `createInvitationEmailQueue`). */
export interface InvitationQueue {
  /** Id del job, o `null` si la cola está deshabilitada o Redis cayó. */
  enqueue(job: InvitationEmailJob): Promise<string | null>;
  /**
   * B-23: un job por elemento en una sola llamada (BullMQ `addBulk`), en vez
   * de `await`ear `enqueue()` una vez por código (hasta
   * `MAX_REMINDERS_PER_REQUEST` seguidos). Mismo orden en la respuesta.
   */
  enqueueBulk(jobs: InvitationEmailJob[]): Promise<Array<string | null>>;
}

// ── Esquemas y vistas ──────────────────────────────────────────────────────

/** Cuerpo de `POST /api/access-keys/:code/confirm` (enlace del email). */
export const ConfirmAttendanceInput = z.object({ token: z.string().min(1).max(512) }).strict();

/** Tope de recordatorios por petición de reenvío masivo. */
export const MAX_REMINDERS_PER_REQUEST = 1000;

export type InvitationSummary = InvitationStats & { requireConfirmation: boolean };

export type EnqueueResult = { requested: number; queued: number };

export type ConfirmResult = {
  status: AccessKeyStatus;
  /** La clave ya estaba confirmada (o no necesitaba confirmación). */
  alreadyConfirmed: boolean;
  eventTitle: string;
};

export type DeliveryResult =
  | { status: "sent"; messageId: string }
  | {
      status: "skipped";
      reason: "NOT_FOUND" | "NO_EMAIL" | "KEY_NOT_LIVE" | "EVENT_NOT_ACTIVE";
    };

/** Estados en los que la clave aún espera confirmación. */
const AWAITING_CONFIRMATION: readonly AccessKeyStatus[] = [
  "generated",
  "sent",
  "pending_confirmation",
];
/** Estados en los que la persona ya confirmó o no le hacía falta. */
const CONFIRMED_OR_BEYOND: readonly AccessKeyStatus[] = ["confirmed", "active", "used"];

const MAX_WRITE_ATTEMPTS = 5;

function isExpired(key: AccessKeyRow, now: Date): boolean {
  return (
    key.status === "expired" || (key.expiresAt !== null && key.expiresAt.getTime() <= now.getTime())
  );
}

/** Idioma de los emails del evento: el fijado en el evento, el del organizador o `es`. */
export function invitationLocale(event: Pick<EventRow, "config">, organizerLocale: string | null) {
  return resolveMailLocale(event.config.locale ?? organizerLocale);
}

/** URL del enlace de confirmación (página pública con next-intl). */
export function confirmationUrl(appUrl: string, locale: string, code: string, token: string) {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}/${locale}/invitations/${encodeURIComponent(code)}/confirm?token=${encodeURIComponent(token)}`;
}

/**
 * Sella el envío: `sentAt` y, si la clave espera confirmación, `generated|sent
 * → pending_confirmation`. Escritura condicional con reintento (un canje o una
 * confirmación simultáneos ganan y solo se añade `sentAt`).
 *
 * Se llama DESPUÉS de un `transport.send()` que no lanzó — nunca antes: si se
 * llamara antes, un fallo del transporte dejaría `sentAt` puesto sin que se
 * hubiera entregado nada. La entrega es **at-least-once a propósito**: si el
 * proceso muere justo tras un envío correcto pero antes de persistir esta
 * marca, BullMQ reintenta el job entero (nunca se marcó como completado) y la
 * persona recibe la invitación por duplicado. Es preferible a una
 * invitación perdida (at-most-once), y el `X-Entity-Ref-ID` estable de
 * `deliverInvitationEmail` (E-20) hace que los clientes de correo agrupen ese
 * posible duplicado con el mensaje original en vez de mostrar dos hilos. No
 * hace falta un outbox como el de compras (#119, E-11): esto no es
 * contabilidad ni tiene efecto legal, es una invitación a jugar que además se
 * puede reenviar a mano (`resend`).
 */
async function recordSent(
  store: Pick<InvitationStore, "findKey" | "updateKey">,
  code: string,
  at: Date,
): Promise<AccessKeyRow | null> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const key = await store.findKey(code);
    if (!key) return null;
    const promote =
      key.requireConfirmation && (key.status === "generated" || key.status === "sent");
    const updated = await store.updateKey(
      code,
      { status: key.status, redeemedCount: key.redeemedCount },
      { sentAt: at, ...(promote ? { status: "pending_confirmation" as const } : {}) },
    );
    if (updated) return updated;
  }
  return null;
}

// ── Entrega (worker) ───────────────────────────────────────────────────────

export type InvitationDeliveryDeps = {
  store: Pick<InvitationStore, "findEvent" | "findKey" | "updateKey" | "describeEvent">;
  transport: MailTransport;
  /** Firma del enlace de confirmación; `null` = confirmación desactivada. */
  confirmation: ConfirmationTokenConfig | null;
  /** URL pública de la web (`APP_URL`), para el enlace. */
  appUrl: string;
  now?: () => Date;
};

/**
 * Procesa un job de `mail.invitation`: lee la clave y el evento **en el momento
 * del envío** (si se rotó, caducó o se canjeó entretanto, no se envía nada
 * viejo), renderiza la plantilla en el idioma del evento y la entrega. Un fallo
 * del transporte se propaga: BullMQ reintenta el job con backoff.
 */
export async function deliverInvitationEmail(
  deps: InvitationDeliveryDeps,
  job: InvitationEmailJob,
): Promise<DeliveryResult> {
  const now = deps.now ?? (() => new Date());
  const key = await deps.store.findKey(job.code);
  if (!key) return { status: "skipped", reason: "NOT_FOUND" };
  if (!key.email) return { status: "skipped", reason: "NO_EMAIL" };
  if (!isLiveAccessKey(key.status) || isExpired(key, now())) {
    return { status: "skipped", reason: "KEY_NOT_LIVE" };
  }
  const [event, extras] = await Promise.all([
    deps.store.findEvent(key.eventId),
    deps.store.describeEvent(key.eventId),
  ]);
  if (!event || event.status !== "active") return { status: "skipped", reason: "EVENT_NOT_ACTIVE" };

  const locale = invitationLocale(event, extras?.organizerLocale ?? null);
  let confirmUrl: string | null = null;
  if (key.requireConfirmation && AWAITING_CONFIRMATION.includes(key.status)) {
    if (!deps.confirmation) {
      throw new AccessKeyError(
        "CONFIRMATION_UNAVAILABLE",
        "Falta el secreto de los enlaces de confirmación",
      );
    }
    const ttlEnd = now().getTime() + deps.confirmation.ttlSeconds * 1000;
    const expiresAt = new Date(Math.min(ttlEnd, key.expiresAt?.getTime() ?? ttlEnd));
    const token = signConfirmationToken({ code: key.code, expiresAt }, deps.confirmation.secret);
    confirmUrl = confirmationUrl(deps.appUrl, locale, key.code, token);
  }

  const rendered = renderInvitationEmail({
    kind: job.kind,
    locale,
    eventTitle: event.title,
    roomTitle: extras?.roomTitle ?? event.title,
    code: key.code,
    confirmUrl,
    expiresAt: key.expiresAt,
  });
  const { messageId } = await deps.transport.send({
    to: key.email,
    ...rendered,
    // Ref estable por (code, kind), no `Date.now()`: un reintento de BullMQ
    // de la MISMA entrega agrupa con el mensaje original en vez de crear un
    // hilo nuevo cada vez (E-20) — así un posible duplicado at-least-once
    // (ver `recordSent`) es menos molesto para quien lo recibe. Un `resend`
    // explícito con otro `kind` (invitación → recordatorio) sí es un mensaje
    // distinto y se hila aparte, que es lo que se quiere.
    headers: { "X-Entity-Ref-ID": `invitation:${job.kind}:${key.code}` },
  });
  await recordSent(deps.store, key.code, now());
  return { status: "sent", messageId };
}

// ── Servicio (web) ─────────────────────────────────────────────────────────

export function createInvitationService(deps: {
  store: InvitationStore;
  /** Generación de claves de 5.5 (valida organizador, límite de asientos, estado). */
  accessKeys: Pick<AccessKeyService, "generateKeys" | "activateEvent" | "requireDpa">;
  queue: InvitationQueue;
  /** `null` = confirmación desactivada (falta el secreto en producción). */
  confirmation: ConfirmationTokenConfig | null;
  now?: () => Date;
}) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());

  async function findOwnEvent(actor: Actor, eventId: string): Promise<EventRow> {
    requireUser(actor, AccessKeyError);
    const event = UUID_RE.test(eventId) ? await store.findEvent(eventId) : null;
    if (!event) throw new AccessKeyError("NOT_FOUND", "Evento no encontrado");
    if (event.organizerId !== actor.userId) {
      throw new AccessKeyError("FORBIDDEN", "Solo el organizador gestiona las claves del evento");
    }
    return event;
  }

  async function enqueue(codes: string[], kind: InvitationEmailKind): Promise<EnqueueResult> {
    // B-23: un `addBulk` en vez de hasta MAX_REMINDERS_PER_REQUEST `await`
    // secuenciales (un round-trip a Redis por código).
    const ids = await deps.queue.enqueueBulk(codes.map((code) => ({ code, kind })));
    const queued = ids.filter((id) => id !== null).length;
    return { requested: codes.length, queued };
  }

  /** Una sola dirección → invitación individual; varias → masiva. */
  function inviteKeys(keys: AccessKeyRow[]): Promise<EnqueueResult> {
    const codes = keys.filter((k) => k.email !== null).map((k) => k.code);
    return enqueue(codes, codes.length === 1 ? "invitation" : "bulk");
  }

  return {
    authorize(actor: Actor): void {
      requireUser(actor, AccessKeyError);
    },

    /**
     * `POST /api/events/:id/activate` — activa y genera las claves del plan
     * (5.5) y encola el envío de las que llevan email.
     */
    async activateAndInvite(
      actor: Actor,
      eventId: string,
      input: unknown = {},
    ): Promise<ActivationResult & { emails: EnqueueResult }> {
      const result = await deps.accessKeys.activateEvent(actor, eventId, input);
      return { ...result, emails: await inviteKeys(result.keys) };
    },

    /**
     * `POST /api/events/:id/access-keys` con `emails`: genera las claves (5.5) y
     * encola un envío por cada una. Una sola dirección → invitación individual;
     * varias → invitación masiva (misma clave personal, otra plantilla).
     * Sin `emails`, solo genera (claves para imprimir o repartir, 5.7).
     */
    async generateAndInvite(
      actor: Actor,
      eventId: string,
      input: unknown,
    ): Promise<{ keys: AccessKeyRow[]; emails: EnqueueResult }> {
      const keys = await deps.accessKeys.generateKeys(actor, eventId, input);
      return { keys, emails: await inviteKeys(keys) };
    },

    /**
     * `POST /api/access-keys/:code/resend` — reenvía la invitación de una clave
     * viva con email. Si aún no confirmó, sale como recordatorio.
     */
    async resend(
      actor: Actor,
      rawCode: string,
    ): Promise<{ code: string; kind: InvitationEmailKind; queued: boolean }> {
      requireUser(actor, AccessKeyError);
      const code = normalizeAccessKeyCode(rawCode);
      const key = code ? await store.findKey(code) : null;
      if (!key) throw new AccessKeyError("NOT_FOUND", "Clave no encontrada");
      const event = await findOwnEvent(actor, key.eventId);
      if (event.status !== "active") {
        throw new AccessKeyError("EVENT_NOT_ACTIVE", "El evento no está activo");
      }
      if (!key.email) {
        throw new AccessKeyError("ACCESS_KEY_NO_EMAIL", "La clave no tiene email al que reenviar");
      }
      await deps.accessKeys.requireDpa(actor);
      if (key.status === "used") {
        throw new AccessKeyError("ACCESS_KEY_USED", "La clave ya se canjeó");
      }
      if (isExpired(key, now())) {
        throw new AccessKeyError("ACCESS_KEY_EXPIRED", "La clave ya no es válida");
      }
      const kind: InvitationEmailKind =
        key.status === "pending_confirmation" ? "reminder" : "invitation";
      const { queued } = await enqueue([key.code], kind);
      return { code: key.code, kind, queued: queued === 1 };
    },

    /**
     * `POST /api/events/:id/invitations/resend` — recordatorio a todas las claves
     * pendientes de confirmar ("reenviar a los 2 pendientes").
     */
    async resendPending(actor: Actor, eventId: string): Promise<EnqueueResult> {
      const event = await findOwnEvent(actor, eventId);
      if (event.status !== "active") {
        throw new AccessKeyError("EVENT_NOT_ACTIVE", "El evento no está activo");
      }
      await deps.accessKeys.requireDpa(actor);
      const codes = await store.listPendingConfirmation(event.id, MAX_REMINDERS_PER_REQUEST);
      return enqueue(codes, "reminder");
    },

    /** `GET /api/events/:id/invitations` — resumen del panel ("28/30 confirmados"). */
    async summary(actor: Actor, eventId: string): Promise<InvitationSummary> {
      const event = await findOwnEvent(actor, eventId);
      const stats = await store.invitationStats(event.id);
      return { ...stats, requireConfirmation: event.requireConfirmation };
    },

    /**
     * `POST /api/access-keys/:code/confirm` — público, desde el enlace del email.
     * La firma se comprueba antes de tocar la base de datos.
     */
    async confirm(rawCode: string, input: unknown): Promise<ConfirmResult> {
      if (!deps.confirmation) {
        throw new AccessKeyError(
          "CONFIRMATION_UNAVAILABLE",
          "La confirmación de asistencia no está disponible",
        );
      }
      const parsed = ConfirmAttendanceInput.safeParse(input);
      if (!parsed.success) {
        throw new AccessKeyError(
          "VALIDATION_ERROR",
          "Datos no válidos",
          toReadableIssues(parsed.error),
        );
      }
      const code = normalizeAccessKeyCode(rawCode);
      const check = code
        ? verifyConfirmationToken(parsed.data.token, code, deps.confirmation.secret, now())
        : ({ ok: false, error: "MALFORMED" } as const);
      if (!check.ok) {
        throw check.error === "EXPIRED"
          ? new AccessKeyError("CONFIRMATION_EXPIRED", "El enlace de confirmación ha caducado")
          : new AccessKeyError("CONFIRMATION_INVALID", "El enlace de confirmación no es válido");
      }

      for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
        const key = await store.findKey(code!);
        if (!key) throw new AccessKeyError("ACCESS_KEY_INVALID", "Clave no válida");
        const event = await store.findEvent(key.eventId);
        const eventTitle = event?.title ?? "";
        if (CONFIRMED_OR_BEYOND.includes(key.status)) {
          return { status: key.status, alreadyConfirmed: true, eventTitle };
        }
        if (isExpired(key, now()) || !event || event.status === "closed") {
          throw new AccessKeyError("ACCESS_KEY_EXPIRED", "La clave ya no es válida");
        }
        const updated = await store.updateKey(
          key.code,
          { status: key.status, redeemedCount: key.redeemedCount },
          { status: "confirmed", confirmedAt: now() },
        );
        if (updated) return { status: updated.status, alreadyConfirmed: false, eventTitle };
      }
      throw new AccessKeyError("CONFLICT", "La clave cambió mientras se confirmaba; reinténtalo");
    },
  };
}

export type InvitationService = ReturnType<typeof createInvitationService>;

// ── Implementación en memoria (tests y superficies sin base de datos) ──────

/**
 * Store en memoria sobre el de claves de 5.5 (`createInMemoryAccessKeyStore`):
 * comparte sus filas, así generar, canjear y enviar ven el mismo estado.
 */
export function createInMemoryInvitationStore(opts: {
  keys: Pick<AccessKeyStore, "findEvent" | "findKey" | "updateKey"> & { keys: AccessKeyRow[] };
  /** Título de la sala por evento (por defecto, el del evento). */
  roomTitles?: Record<string, string>;
  /** `user.locale` por organizador. */
  organizerLocales?: Record<string, string>;
}): InvitationStore {
  const { keys } = opts;
  const replaced = () =>
    new Set(keys.keys.flatMap((k) => (k.regeneratedFrom ? [k.regeneratedFrom] : [])));
  const invitations = (eventId: string) => {
    const gone = replaced();
    return keys.keys.filter((k) => k.eventId === eventId && k.email !== null && !gone.has(k.code));
  };
  return {
    findEvent: (id) => keys.findEvent(id),
    findKey: (code) => keys.findKey(code),
    updateKey: (code, expected, patch) => keys.updateKey(code, expected, patch),
    async describeEvent(eventId) {
      const event = await keys.findEvent(eventId);
      if (!event) return null;
      return {
        roomTitle: opts.roomTitles?.[eventId] ?? event.title,
        organizerLocale: opts.organizerLocales?.[event.organizerId] ?? null,
      };
    },
    async invitationStats(eventId) {
      const rows = invitations(eventId);
      return {
        invited: rows.length,
        sent: rows.filter((k) => k.sentAt !== null).length,
        confirmed: rows.filter((k) => k.confirmedAt !== null).length,
        pending: rows.filter((k) => AWAITING_CONFIRMATION.includes(k.status)).length,
        expired: rows.filter((k) => k.status === "expired" && k.confirmedAt === null).length,
      };
    },
    async listPendingConfirmation(eventId, limit) {
      return invitations(eventId)
        .filter((k) => k.status === "pending_confirmation")
        .slice(0, limit)
        .map((k) => k.code);
    },
  };
}
