import { z } from "zod";
import { logger } from "@escaperoom/kit/logger";
import { LOCALES, type Locale } from "@escaperoom/config/locales";
import { toReadableIssues, type ReadableIssue } from "../schemas/errors";
import { type Actor } from "./actor";
import type { AdminDirectory } from "./admin";
import { UUID_RE, requireUser } from "./common";
import {
  quotePricing,
  type PricingQuote,
  type PricingSnapshot,
  type PricingTierService,
} from "./pricing-tiers";

/**
 * Eventos B2B / B2Educación (ticket 5.4, specs/02 §3, specs/13 §6.1).
 *
 * Un organizador monta una jornada sobre una `roomVersion` publicada (inmutable,
 * 3.9). Al crearla se congelan los tramos vigentes en `event.pricingSnapshot`
 * (3.12) y el total sale de `quotePricing` sobre ESE snapshot: cambiar después
 * los tramos no altera ni el snapshot ni el precio del evento.
 *
 * - Autoventa (`organizerId === room.authorId`): claves gratis, sin checkout y
 *   el evento es activable directamente.
 * - Evento ajeno: queda en `draft` con el pago pendiente (ticket 5.1, Stripe
 *   Checkout). El importe se congela en una `purchase` `event_credits`
 *   `pending` al abrir el checkout (auditoría 2026-09-24, B-1/B-8): el webhook
 *   liquida por esa `purchaseId` y comprueba que la Session y el importe
 *   cobrado coinciden con lo congelado, nunca con el precio recalculado.
 *
 * El estado del pago y los flags de vídeo/grabación viven en `event.config`
 * (JSONB, specs/12 §4). `version` (auditoría 2026-09-24, B-11) da concurrencia
 * optimista sobre esa escritura: un `PATCH` concurrente con `startCheckout` o
 * con el webhook liquidando el pago ya no puede pisar la escritura del otro.
 */

// ── Tipos de dominio ───────────────────────────────────────────────────────

export const EVENT_STATUSES = ["draft", "active", "closed"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const GROUPING_MODES = ["specific", "random", "free"] as const;
export type GroupingMode = (typeof GROUPING_MODES)[number];

export const EVENT_AUDIENCES = ["general", "educational"] as const;
export type EventAudience = (typeof EVENT_AUDIENCES)[number];

/** Hasta 10 sesiones simultáneas por evento (specs/02 §3.1). */
export const MAX_SIMULTANEOUS_SESSIONS = 10;
/** Tope de cordura de jugadores por evento (el mismo que admiten los tramos). */
export const MAX_EVENT_PLAYERS = 100_000;
/**
 * `gameSession.capacity` es `smallint` (auditoría 2026-09-24, B-17): el máximo
 * de jugadores que puede aceptar una sola sesión repartida por `defaultSessions`.
 */
export const MAX_SESSION_CAPACITY = 32_767;
export const MAX_EVENT_TITLE_LENGTH = 200;

/** Reglas de caducidad de claves, combinables (specs/02 §4.3). */
export type ExpiryRule =
  | { type: "hours_after_start"; startsAt: string; hours: number }
  | { type: "on_session_end" }
  | { type: "on_group_complete" };

/**
 * Estado del pago: `not_required` (autoventa), `pending` (evento ajeno aún sin
 * pagar), `paid` (lo marca el webhook al liquidar la `purchase` congelada) o
 * `refunded` (reembolso total del webhook, B-5: bloquea `activate`/`generateKeys`).
 */
export type EventPaymentStatus = "not_required" | "pending" | "paid" | "refunded";

/** Contenido de `event.config` (JSONB). */
export type EventConfig = {
  allowVideo: boolean;
  /**
   * Ticket duración-salas (specs/02 §7, specs/21): el organizador puede
   * poner cualquier duración de partida para SU evento (más corta, más
   * larga o sin límite), por encima de la de la sala. Tres estados, igual
   * que `meta.timeLimitMinutes` de la sala:
   * - **ausente** (clave sin la propiedad, no `undefined` explícito): sin
   *   override — la partida usa la duración propia de la sala. Es la marca
   *   que decide si una partida cuenta para el ranking público (specs/21):
   *   presente = duración modificada, se excluye.
   * - **`null`**: override explícito a "sin duración".
   * - **entero positivo**: el límite en minutos para este evento.
   */
  timeLimitMinutes?: number | null;
  recordingEnabled: boolean;
  /** Instante en que el organizador aceptó el texto de grabación (specs/12 §5.2). */
  recordingAcceptedAt: string | null;
  /** Congelado al crear: el organizador era el autor de la sala. */
  selfSale: boolean;
  /**
   * Idioma de los emails de invitación (5.6). Sin él se usa el del organizador
   * (`user.locale`) y, en último caso, `es`.
   */
  locale?: Locale;
  payment: {
    status: EventPaymentStatus;
    /** Referencia opaca del checkout abierto en la pasarela (5.1): el `id` de la Checkout Session. */
    checkoutRef: string | null;
    /** `purchase` `event_credits` que congela el importe de ESTE checkout (B-1/B-8). */
    purchaseId: string | null;
    paidAt: string | null;
  };
};

/** Fila de `event`. */
export type EventRow = {
  id: string;
  organizerId: string;
  roomVersionId: string;
  /** Sala de la versión (join con `roomVersion`, no es columna de `event`). */
  roomId: string;
  title: string;
  audience: EventAudience;
  maxSimultaneousSessions: number;
  groupingMode: GroupingMode;
  requireConfirmation: boolean;
  config: EventConfig;
  expiryRules: ExpiryRule[];
  pricingSnapshot: PricingSnapshot;
  playersPurchased: number;
  status: EventStatus;
  /** Concurrencia optimista de `config` (B-11): cada escritura la exige y la incrementa. */
  version: number;
  createdAt: Date;
};

export type NewEventRow = Omit<EventRow, "id" | "createdAt" | "roomId" | "status" | "version">;

/** Campos editables mientras el evento está en `draft`. */
export type EventPatch = Partial<
  Pick<
    EventRow,
    | "title"
    | "audience"
    | "maxSimultaneousSessions"
    | "groupingMode"
    | "requireConfirmation"
    | "config"
    | "expiryRules"
    | "playersPurchased"
    | "status"
  >
>;

/** Lo que el servicio necesita saber de la versión y su sala. */
export type EventRoomVersionRef = {
  roomVersionId: string;
  roomId: string;
  authorId: string;
  roomStatus: "draft" | "published" | "unlisted" | "archived" | "removed";
  saleEvents: boolean;
  /**
   * `meta.estimatedMinutes` de la sala (ticket duración-salas): para avisar
   * si el override la acorta. Opcional para no romper otros `EventStore` de
   * prueba que no lo necesitan (nada usa esta ref fuera de create/update).
   */
  estimatedMinutes?: number;
  /**
   * `meta.timeLimitMinutes` de la sala (PR #169, cierre del punto parcial de
   * los tokens de reconexión): la duración PROPIA de la sala, para cuando el
   * evento no la sobrescribe. Mismos tres estados que en `RoomPackageMeta`:
   * ausente = retrocompat 60 min, `null` = sin duración, número = minutos.
   * Ausente aquí también cuando el `EventStore` de prueba no lo implementa.
   */
  timeLimitMinutes?: number | null;
};

/** Resumen del detalle (specs/13 §6.1): nº de sesiones y nº de claves por estado. */
export type EventSummary = {
  sessions: number;
  accessKeysByStatus: Record<string, number>;
};

export type EventListCursor = { createdAt: Date; id: string };

/** Estado de la `purchase` `event_credits` que congela un checkout de evento (B-1/B-8). */
export type EventPurchaseStatus = "pending" | "succeeded" | "failed" | "refunded";

export type EventPurchaseRef = {
  id: string;
  eventId: string;
  amountCents: number;
  currency: string;
  status: EventPurchaseStatus;
};

export type NewEventPurchase = {
  id: string;
  eventId: string;
  organizerId: string;
  amountCents: number;
  currency: string;
  /** `id` de la Checkout Session recién abierta: satisface `chkPurchasePaidNeedsStripe`. */
  checkoutRef: string;
};

/** Puerto de persistencia de eventos (ADR-022). */
export interface EventStore extends AdminDirectory {
  /** Versión + sala, ignorando salas borradas (`deletedAt`). */
  findRoomVersion(roomVersionId: string): Promise<EventRoomVersionRef | null>;
  insertEvent(event: NewEventRow): Promise<EventRow>;
  findEvent(id: string): Promise<EventRow | null>;
  /**
   * Aplica `patch` solo si el evento sigue en `expected.status` Y en
   * `expected.version` (concurrencia optimista, B-11). `null` si cualquiera de
   * las dos cambió (o el evento ya no existe): quien pierde la carrera relee y
   * decide (reintentar o rechazar), nunca pisa a ciegas.
   */
  updateEvent(
    id: string,
    expected: { status: EventStatus; version: number },
    patch: EventPatch,
  ): Promise<EventRow | null>;
  /** Eventos del organizador, `createdAt DESC, id DESC`, estrictamente tras `after`. */
  listByOrganizer(
    organizerId: string,
    opts: { limit: number; after: EventListCursor | null },
  ): Promise<EventRow[]>;
  summarize(eventId: string): Promise<EventSummary>;

  // ── Purchase `event_credits` (B-1/B-8): congela importe y liquida por id ──
  insertEventPurchase(purchase: NewEventPurchase): Promise<void>;
  findEventPurchase(purchaseId: string): Promise<EventPurchaseRef | null>;
  /** `pending → succeeded` con la referencia de pago real; `false` si ya no estaba `pending`. */
  settleEventPurchase(purchaseId: string, paymentRef: string): Promise<boolean>;
  /** `pending → failed`: al expirar un checkout (reapertura) o cuando Stripe confirma su expiración. */
  markEventPurchaseFailed(purchaseId: string): Promise<void>;
  /** La `purchase` `succeeded` de este evento con esa referencia de pago (para `charge.refunded`, B-5). */
  findEventPurchaseByPaymentRef(paymentRef: string): Promise<EventPurchaseRef | null>;
  /** `succeeded → refunded`; `null` si no había compra `succeeded` con esa referencia. */
  markEventPurchaseRefunded(purchaseId: string): Promise<boolean>;
}

/**
 * Pasarela de pago (Stripe Checkout, ticket 5.1). Ni 5.4 ni 5.10 la
 * implementan directamente: web la cablea a `null` y los tests usan
 * `createFakePaymentGateway`.
 */
export interface PaymentGateway {
  createEventCheckout(input: {
    purchaseId: string;
    eventId: string;
    organizerId: string;
    title: string;
    players: number;
    amountCents: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ checkoutRef: string; url: string }>;
  /**
   * Licencia de sala entre creadores (5.10, `purchase_type: 'room_license'`).
   * El `purchaseId` viaja en la metadata del checkout: al confirmarse el pago,
   * el webhook de 5.1 llama a `RoomLicenseService.confirmLicensePayment`.
   */
  createLicenseCheckout(input: {
    purchaseId: string;
    buyerId: string;
    roomId: string;
    roomVersionId: string;
    title: string;
    amountCents: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ checkoutRef: string; url: string }>;
  /**
   * Venta individual de una sala a un jugador (ticket 5.1, `purchase_type:
   * 'room'`, specs/13 §5). El `purchaseId` viaja en `metadata` del checkout Y
   * del `PaymentIntent` (`payment_intent_data.metadata`), para que
   * `payment_intent.payment_failed` pueda resolver la compra sin depender de
   * la Session.
   */
  createRoomCheckout(input: {
    purchaseId: string;
    buyerId: string;
    roomId: string;
    roomVersionId: string;
    title: string;
    amountCents: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ checkoutRef: string; url: string }>;
  /**
   * Expira una Checkout Session abierta (B-1): se usa antes de reabrir un
   * checkout (`startCheckout` con `checkoutRef` ya presente) para que la
   * Session vieja nunca pueda completarse con el importe/jugadores
   * originales tras haberlos cambiado. Idempotente: expirar una Session ya
   * expirada o completada no debe lanzar.
   */
  expireCheckout(checkoutRef: string): Promise<void>;
  /**
   * Transferencia del reparto del creador tras el cobro ("separate charges
   * and transfers", specs/02 §2): NUNCA `application_fee_amount`, incompatible
   * con este modelo. `paymentIntentId` ata la transferencia al cargo original
   * (`source_transaction`) para que Stripe la financie con esos fondos.
   * Idempotente por `purchaseId` (B-3): una segunda llamada con el mismo
   * `purchaseId` nunca duplica la transferencia.
   */
  createTransfer(input: {
    purchaseId: string;
    amountCents: number;
    currency: string;
    destinationAccountId: string;
    paymentIntentId: string;
  }): Promise<{ transferId: string }>;
  /**
   * Reversión parcial/total de una `Transfer` ya hecha (B-5): cuando Stripe
   * reembolsa el cargo original, el reparto ya entregado al creador se
   * devuelve proporcionalmente para que la plataforma no cargue sola con el
   * reembolso.
   */
  reverseTransfer(input: { transferId: string; amountCents: number }): Promise<void>;
}

// ── Errores ────────────────────────────────────────────────────────────────

export type EventErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "ROOM_VERSION_UNAVAILABLE"
  | "SALE_EVENTS_DISABLED"
  | "PRICING_UNAVAILABLE"
  | "EVENT_NOT_EDITABLE"
  | "CHECKOUT_NOT_REQUIRED"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_GATEWAY_UNAVAILABLE";

/** Error de dominio de eventos; los adaptadores lo traducen a HTTP/tRPC/MCP. */
export class EventError extends Error {
  readonly code: EventErrorCode;
  readonly issues: ReadableIssue[];
  constructor(code: EventErrorCode, message: string, issues: ReadableIssue[] = []) {
    super(message);
    this.name = "EventError";
    this.code = code;
    this.issues = issues;
  }
}

function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new EventError("VALIDATION_ERROR", "Datos no válidos", toReadableIssues(parsed.error));
  }
  return parsed.data;
}

// ── Esquemas de entrada ────────────────────────────────────────────────────

export const ExpiryRuleSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("hours_after_start"),
      startsAt: z.iso.datetime({ offset: true }),
      hours: z
        .number()
        .int()
        .min(1)
        .max(24 * 30),
    })
    .strict(),
  z.object({ type: z.literal("on_session_end") }).strict(),
  z.object({ type: z.literal("on_group_complete") }).strict(),
]);

const expiryRules = z
  .array(ExpiryRuleSchema)
  .max(3)
  .refine((rules) => new Set(rules.map((r) => r.type)).size === rules.length, {
    message: "Cada tipo de regla de caducidad solo puede aparecer una vez",
  });

const title = z.string().trim().min(1).max(MAX_EVENT_TITLE_LENGTH);
const sessions = z.number().int().min(1).max(MAX_SIMULTANEOUS_SESSIONS);
const players = z.number().int().min(1).max(MAX_EVENT_PLAYERS);

const RECORDING_EDUCATIONAL = {
  message: "La grabación no está disponible en eventos educativos",
  path: ["recordingEnabled"],
};

/** `playersPlanned` debe caber en las sesiones que `defaultSessions` repartirá (B-17). */
function fitsSessionCapacity(playersPlanned: number, maxSimultaneousSessions: number): boolean {
  return playersPlanned <= maxSimultaneousSessions * MAX_SESSION_CAPACITY;
}

const PLAYERS_EXCEED_CAPACITY = {
  message: `Con este número de sesiones, cada una superaría los ${MAX_SESSION_CAPACITY} jugadores permitidos`,
  path: ["playersPlanned"],
};

/** Cuerpo de `POST /api/events` (specs/13 §6.1). */
export const CreateEventInput = z
  .object({
    roomVersionId: z.string().regex(UUID_RE, "UUID no válido"),
    title,
    maxSimultaneousSessions: sessions,
    groupingMode: z.enum(GROUPING_MODES),
    requireConfirmation: z.boolean(),
    expiryRules,
    playersPlanned: players,
    audience: z.enum(EVENT_AUDIENCES).default("general"),
    /** Por defecto `false` en cualquier evento (specs/12 §4). */
    allowVideo: z.boolean().default(false),
    recordingEnabled: z.boolean().default(false),
    /**
     * Override de duración del evento (ticket duración-salas): omitido = sin
     * override (usa la de la sala); `null` = sin duración; entero positivo =
     * minutos. Se envía explícitamente como `null` para "sin duración", nunca
     * se omite para conseguir el mismo efecto (ausente ≠ `null`).
     */
    timeLimitMinutes: z.number().int().positive().nullable().optional(),
    /** Idioma de los emails de invitación (5.6). */
    locale: z.enum(LOCALES).optional(),
  })
  .strict()
  .refine((e) => !(e.recordingEnabled && e.audience === "educational"), RECORDING_EDUCATIONAL)
  .refine(
    (e) => fitsSessionCapacity(e.playersPlanned, e.maxSimultaneousSessions),
    PLAYERS_EXCEED_CAPACITY,
  );

/** Cuerpo de `PATCH /api/events/:id`: cualquier subconjunto de la configuración. */
export const UpdateEventInput = z
  .object({
    title: title.optional(),
    maxSimultaneousSessions: sessions.optional(),
    groupingMode: z.enum(GROUPING_MODES).optional(),
    requireConfirmation: z.boolean().optional(),
    expiryRules: expiryRules.optional(),
    playersPlanned: players.optional(),
    audience: z.enum(EVENT_AUDIENCES).optional(),
    allowVideo: z.boolean().optional(),
    recordingEnabled: z.boolean().optional(),
    /**
     * `null` fija/mantiene "sin duración"; un entero fija el override en
     * minutos. **Ausente** significa "no tocar" en un `PATCH` (semántica
     * habitual de este esquema) — para QUITAR el override y volver a la
     * duración de la sala hay que usar `clearTimeLimitOverride: true`.
     */
    timeLimitMinutes: z.number().int().positive().nullable().optional(),
    /** Ticket duración-salas: quita el override y vuelve a la duración de la sala. */
    clearTimeLimitOverride: z.boolean().optional(),
    locale: z.enum(LOCALES).optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: "No hay cambios que aplicar" })
  .refine((p) => !(p.clearTimeLimitOverride && p.timeLimitMinutes !== undefined), {
    message: "No se puede fijar `timeLimitMinutes` y quitar el override a la vez",
    path: ["clearTimeLimitOverride"],
  });

export const ListEventsQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Vistas ─────────────────────────────────────────────────────────────────

/** Precio del evento según SU snapshot congelado. */
export type EventPricing = PricingQuote & {
  /** Lo que se cobra: 0 en autoventa, el total en otro caso. */
  amountDueCents: number;
  selfSale: boolean;
};

export type EventView = EventRow & {
  pricing: EventPricing;
  /** `true` si puede pasar a `active` sin más pasos (autoventa o ya pagado). */
  activatable: boolean;
  /**
   * Ticket duración-salas: `true` si el override de duración de este evento
   * (`config.timeLimitMinutes`) es un número por debajo del
   * `estimatedMinutes` de la sala. Solo se calcula en `createEvent`/
   * `updateEvent` (donde se conoce ese dato); en otros sitios sale `false`.
   * Aviso, no bloqueo: el organizador puede acortar la duración a propósito.
   */
  timeLimitBelowEstimate: boolean;
};

export type EventDetail = EventView & { summary: EventSummary };

export type EventPage = { items: EventView[]; nextCursor: string | null };

/** Resultado de `markPaid` (B-1): nunca lanza — un desajuste se registra, no se activa. */
export type MarkPaidResult =
  | { outcome: "settled"; event: EventView }
  | { outcome: "already_settled"; event: EventView }
  | { outcome: "mismatch"; event: EventView }
  | { outcome: "not_found" };

/** Pago saldado: ya se puede activar. */
function paymentSettled(config: EventConfig): boolean {
  return config.payment.status === "not_required" || config.payment.status === "paid";
}

function priceOrThrow(snapshot: PricingSnapshot, playerCount: number): PricingQuote {
  const quote = quotePricing(snapshot, playerCount);
  if (!quote) {
    throw new EventError(
      "PRICING_UNAVAILABLE",
      `Ningún tramo de precio vigente cubre ${playerCount} jugadores`,
    );
  }
  return quote;
}

/**
 * Vista de un evento: precio recalculado desde su snapshot (nunca desde los
 * tramos actuales). `roomEstimatedMinutes` (ticket duración-salas) solo lo
 * pasan `createEvent`/`updateEvent`, que conocen el `estimatedMinutes` de la
 * sala; en el resto de sitios `timeLimitBelowEstimate` sale `false`.
 */
export function toEventView(event: EventRow, roomEstimatedMinutes?: number): EventView {
  const quote = quotePricing(event.pricingSnapshot, event.playersPurchased);
  // Un evento siempre se crea con un precio válido: `null` solo si el JSONB se corrompió.
  const base = quote ?? {
    tierId: "",
    players: event.playersPurchased,
    unitPriceCents: 0,
    totalCents: 0,
    currency: event.pricingSnapshot.tiers[0]?.currency ?? "EUR",
  };
  const overrideMinutes = event.config.timeLimitMinutes;
  return {
    ...event,
    pricing: {
      ...base,
      amountDueCents: event.config.selfSale ? 0 : base.totalCents,
      selfSale: event.config.selfSale,
    },
    activatable: event.status === "draft" && paymentSettled(event.config),
    timeLimitBelowEstimate:
      roomEstimatedMinutes !== undefined &&
      typeof overrideMinutes === "number" &&
      overrideMinutes < roomEstimatedMinutes,
  };
}

function encodeCursor(c: EventListCursor): string {
  return Buffer.from(JSON.stringify([c.createdAt.toISOString(), c.id])).toString("base64url");
}

function decodeCursor(raw: string): EventListCursor {
  try {
    const [at, id] = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown[];
    const createdAt = new Date(String(at));
    if (typeof id === "string" && UUID_RE.test(id) && !Number.isNaN(createdAt.getTime())) {
      return { createdAt, id };
    }
  } catch {
    // cae al error de abajo
  }
  throw new EventError("VALIDATION_ERROR", "Cursor no válido", [
    { path: "cursor", message: "Cursor no válido" },
  ]);
}

/** Salas sobre las que se puede montar un evento. */
const EVENT_ROOM_STATUSES: ReadonlySet<EventRoomVersionRef["roomStatus"]> = new Set([
  "published",
  "unlisted",
]);

// ── Servicio ───────────────────────────────────────────────────────────────

export function createEventService(deps: {
  store: EventStore;
  /** Solo se usa `snapshotAt` de 3.12: los tramos no se reimplementan aquí. */
  pricing: Pick<PricingTierService, "snapshotAt">;
  /** `null` sin `STRIPE_SECRET_KEY` configurada: el checkout responde `PAYMENT_GATEWAY_UNAVAILABLE`. */
  payments: PaymentGateway | null;
  now?: () => Date;
  newId?: () => string;
}) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());

  async function findEvent(id: string): Promise<EventRow> {
    const event = UUID_RE.test(id) ? await store.findEvent(id) : null;
    if (!event) throw new EventError("NOT_FOUND", "Evento no encontrado");
    return event;
  }

  /** Solo el organizador (escrituras). */
  async function findOwnEvent(actor: Actor, id: string): Promise<EventRow> {
    requireUser(actor, EventError);
    const event = await findEvent(id);
    if (event.organizerId !== actor.userId) {
      throw new EventError("FORBIDDEN", "Solo el organizador puede gestionar este evento");
    }
    return event;
  }

  function notEditable(): EventError {
    return new EventError("EVENT_NOT_EDITABLE", "El evento ya no está en borrador");
  }

  function expected(event: EventRow): { status: EventStatus; version: number } {
    return { status: event.status, version: event.version };
  }

  return {
    /** Solo el guard de sesión (los adaptadores lo usan antes de leer el cuerpo). */
    authorize(actor: Actor): void {
      requireUser(actor, EventError);
    },

    /**
     * `POST /api/events` — valida `saleEvents`, congela los tramos vigentes y
     * calcula el total. Autoventa del autor: gratis y activable; si no, el
     * evento queda en `draft` con el pago pendiente.
     */
    async createEvent(actor: Actor, input: unknown): Promise<EventView> {
      requireUser(actor, EventError);
      const data = parseOrThrow(CreateEventInput, input);
      const version = await store.findRoomVersion(data.roomVersionId);
      if (!version || !EVENT_ROOM_STATUSES.has(version.roomStatus)) {
        throw new EventError(
          "ROOM_VERSION_UNAVAILABLE",
          "La versión no existe o su sala no está publicada",
        );
      }
      const selfSale = version.authorId === actor.userId;
      if (!selfSale && !version.saleEvents) {
        throw new EventError("SALE_EVENTS_DISABLED", "La sala no está a la venta para eventos");
      }
      const at = now();
      const pricingSnapshot = await deps.pricing.snapshotAt(at);
      priceOrThrow(pricingSnapshot, data.playersPlanned);

      const event = await store.insertEvent({
        organizerId: actor.userId,
        roomVersionId: version.roomVersionId,
        title: data.title,
        audience: data.audience,
        maxSimultaneousSessions: data.maxSimultaneousSessions,
        groupingMode: data.groupingMode,
        requireConfirmation: data.requireConfirmation,
        expiryRules: data.expiryRules,
        pricingSnapshot,
        playersPurchased: data.playersPlanned,
        config: {
          allowVideo: data.allowVideo,
          recordingEnabled: data.recordingEnabled,
          recordingAcceptedAt: data.recordingEnabled ? at.toISOString() : null,
          selfSale,
          ...(data.timeLimitMinutes !== undefined
            ? { timeLimitMinutes: data.timeLimitMinutes }
            : {}),
          ...(data.locale ? { locale: data.locale } : {}),
          payment: {
            status: selfSale ? "not_required" : "pending",
            checkoutRef: null,
            purchaseId: null,
            paidAt: null,
          },
        },
      });
      return toEventView(event, version.estimatedMinutes);
    },

    /** `GET /api/events/:id` — organizador o admin de plataforma; incluye el resumen. */
    async getEvent(actor: Actor, id: string): Promise<EventDetail> {
      requireUser(actor, EventError);
      const event = await findEvent(id);
      if (event.organizerId !== actor.userId && !(await store.isAdmin(actor.userId))) {
        throw new EventError("FORBIDDEN", "Solo el organizador puede ver este evento");
      }
      return { ...toEventView(event), summary: await store.summarize(event.id) };
    },

    /** `GET /api/me/events` — eventos propios como organizador, paginados por cursor. */
    async listMyEvents(actor: Actor, query: unknown = {}): Promise<EventPage> {
      requireUser(actor, EventError);
      const { cursor, limit } = parseOrThrow(ListEventsQuery, query);
      const rows = await store.listByOrganizer(actor.userId, {
        limit: limit + 1,
        after: cursor === undefined ? null : decodeCursor(cursor),
      });
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return {
        items: items.map(toEventView),
        nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
      };
    },

    /**
     * `PATCH /api/events/:id` — edita la configuración mientras `status = draft`.
     * Cambiar `playersPlanned` recalcula el total con el snapshot DEL EVENTO
     * (no con los tramos actuales) y solo se permite si no hay checkout abierto
     * (el importe ya está congelado en la `purchase` de ese checkout, B-1).
     */
    async updateEvent(actor: Actor, id: string, input: unknown): Promise<EventView> {
      const event = await findOwnEvent(actor, id);
      const data = parseOrThrow(UpdateEventInput, input);
      if (event.status !== "draft") throw notEditable();

      const audience = data.audience ?? event.audience;
      const recordingEnabled = data.recordingEnabled ?? event.config.recordingEnabled;
      if (recordingEnabled && audience === "educational") {
        throw new EventError("VALIDATION_ERROR", "Datos no válidos", [
          { path: "recordingEnabled", message: RECORDING_EDUCATIONAL.message },
        ]);
      }
      if (
        (data.playersPlanned !== undefined || data.maxSimultaneousSessions !== undefined) &&
        !fitsSessionCapacity(
          data.playersPlanned ?? event.playersPurchased,
          data.maxSimultaneousSessions ?? event.maxSimultaneousSessions,
        )
      ) {
        throw new EventError("VALIDATION_ERROR", "Datos no válidos", [
          { path: "playersPlanned", message: PLAYERS_EXCEED_CAPACITY.message },
        ]);
      }
      if (data.playersPlanned !== undefined && data.playersPlanned !== event.playersPurchased) {
        if (
          event.config.payment.status === "paid" ||
          event.config.payment.status === "refunded" ||
          event.config.payment.checkoutRef !== null
        ) {
          throw new EventError(
            "EVENT_NOT_EDITABLE",
            "No se puede cambiar el nº de jugadores con un pago en curso o hecho",
          );
        }
        priceOrThrow(event.pricingSnapshot, data.playersPlanned);
      }

      const recordingTurnedOn = recordingEnabled && !event.config.recordingEnabled;
      const { timeLimitMinutes: existingTimeLimitOverride, ...configWithoutTimeLimit } =
        event.config;
      const patch: EventPatch = {
        title: data.title,
        audience: data.audience,
        maxSimultaneousSessions: data.maxSimultaneousSessions,
        groupingMode: data.groupingMode,
        requireConfirmation: data.requireConfirmation,
        expiryRules: data.expiryRules,
        playersPurchased: data.playersPlanned,
        config: {
          ...configWithoutTimeLimit,
          allowVideo: data.allowVideo ?? event.config.allowVideo,
          recordingEnabled,
          recordingAcceptedAt: !recordingEnabled
            ? null
            : recordingTurnedOn
              ? now().toISOString()
              : event.config.recordingAcceptedAt,
          ...(data.clearTimeLimitOverride
            ? {}
            : data.timeLimitMinutes !== undefined
              ? { timeLimitMinutes: data.timeLimitMinutes }
              : existingTimeLimitOverride !== undefined
                ? { timeLimitMinutes: existingTimeLimitOverride }
                : {}),
          ...(data.locale ? { locale: data.locale } : {}),
        },
      };
      const updated = await store.updateEvent(event.id, expected(event), patch);
      if (!updated) throw notEditable();
      const finalOverride = updated.config.timeLimitMinutes;
      const roomEstimatedMinutes =
        typeof finalOverride === "number"
          ? (await store.findRoomVersion(updated.roomVersionId))?.estimatedMinutes
          : undefined;
      return toEventView(updated, roomEstimatedMinutes);
    },

    /**
     * `POST /api/events/:id/checkout` — abre el pago por el total en la
     * pasarela y congela ese importe en una `purchase` `event_credits`
     * `pending` (B-1/B-8): el webhook liquidará por su id, nunca recalculando
     * desde `playersPurchased` en el momento del pago.
     *
     * Si ya había un checkout abierto (reintento, o el organizador lo cerró y
     * vuelve a intentarlo) se expira esa Session vieja primero: nunca
     * coexisten dos checkouts cobrables para el mismo evento (B-1).
     */
    async startCheckout(
      actor: Actor,
      id: string,
      urls: { successUrl: string; cancelUrl: string },
    ): Promise<{ event: EventView; checkoutUrl: string }> {
      const event = await findOwnEvent(actor, id);
      if (event.status !== "draft") throw notEditable();
      if (paymentSettled(event.config)) {
        throw new EventError("CHECKOUT_NOT_REQUIRED", "Este evento no requiere pago");
      }
      if (!deps.payments) {
        throw new EventError(
          "PAYMENT_GATEWAY_UNAVAILABLE",
          "El pago de eventos todavía no está disponible",
        );
      }
      if (event.config.payment.checkoutRef) {
        await deps.payments.expireCheckout(event.config.payment.checkoutRef);
        if (event.config.payment.purchaseId) {
          await store.markEventPurchaseFailed(event.config.payment.purchaseId);
        }
      }

      const view = toEventView(event);
      const purchaseId = newId();
      const checkout = await deps.payments.createEventCheckout({
        purchaseId,
        eventId: event.id,
        organizerId: event.organizerId,
        title: event.title,
        players: event.playersPurchased,
        amountCents: view.pricing.amountDueCents,
        currency: view.pricing.currency,
        successUrl: urls.successUrl,
        cancelUrl: urls.cancelUrl,
      });
      // Primero el checkout (con el id de la compra ya fijado en su metadata) y
      // luego la `purchase` con su referencia: el CHECK de `purchase` no admite
      // una compra con importe y sin referencia de pago (mismo orden que 5.1/5.10).
      await store.insertEventPurchase({
        id: purchaseId,
        eventId: event.id,
        organizerId: event.organizerId,
        amountCents: view.pricing.amountDueCents,
        currency: view.pricing.currency,
        checkoutRef: checkout.checkoutRef,
      });
      const updated = await store.updateEvent(event.id, expected(event), {
        config: {
          ...event.config,
          payment: { ...event.config.payment, checkoutRef: checkout.checkoutRef, purchaseId },
        },
      });
      if (!updated) throw notEditable();
      return { event: toEventView(updated), checkoutUrl: checkout.url };
    },

    /**
     * `checkout.session.completed` (`purchaseType: 'event_credits'`): liquida
     * el pago por `purchaseId` (B-1/B-8), comprobando que la Session y el
     * importe cobrado coinciden con lo congelado al abrir el checkout. Si no
     * cuadra, NO se activa nada: se registra como error para revisión manual
     * (nunca se confía en `playersPurchased`/el precio recalculado en el
     * momento del webhook). Interna, sin actor: la invoca el webhook de
     * Stripe tras verificar la firma. Idempotente.
     *
     * A diferencia de la versión anterior, NO activa el evento (B-2): solo
     * marca `payment.status = paid`. El organizador (o un plan por defecto)
     * activa explícitamente con `POST /api/events/:id/activate`.
     */
    async markPaid(input: {
      purchaseId: string;
      sessionId: string;
      paymentIntentId: string;
      amountTotalCents: number;
    }): Promise<MarkPaidResult> {
      const purchase = await store.findEventPurchase(input.purchaseId);
      if (!purchase) {
        logger.error(
          { purchaseId: input.purchaseId },
          "events.markPaid: purchase de evento no encontrada",
        );
        return { outcome: "not_found" };
      }
      if (purchase.status === "succeeded") {
        // Replay del webhook: ya se liquidó, nada más que hacer.
        return { outcome: "already_settled", event: toEventView(await findEvent(purchase.eventId)) };
      }
      if (purchase.status !== "pending") {
        logger.error(
          { purchaseId: input.purchaseId, status: purchase.status },
          "events.markPaid: la compra ya no está pendiente de pago",
        );
        return { outcome: "mismatch", event: toEventView(await findEvent(purchase.eventId)) };
      }

      const event = await findEvent(purchase.eventId);
      const mismatch =
        event.config.payment.checkoutRef !== input.sessionId ||
        purchase.amountCents !== input.amountTotalCents;
      if (mismatch) {
        logger.error(
          {
            purchaseId: input.purchaseId,
            eventId: event.id,
            expectedSession: event.config.payment.checkoutRef,
            gotSession: input.sessionId,
            expectedAmountCents: purchase.amountCents,
            gotAmountCents: input.amountTotalCents,
          },
          "events.markPaid: la Session o el importe cobrado no coinciden con lo congelado; no se activa el pago",
        );
        return { outcome: "mismatch", event: toEventView(event) };
      }

      const settled = await store.settleEventPurchase(purchase.id, input.paymentIntentId);
      if (!settled) {
        // Carrera perdida (confirmación concurrente): quien ganó ya liquidó.
        return { outcome: "already_settled", event: toEventView(await findEvent(event.id)) };
      }
      const updated = await store.updateEvent(event.id, expected(event), {
        config: {
          ...event.config,
          payment: { ...event.config.payment, status: "paid", paidAt: now().toISOString() },
        },
      });
      const finalView = toEventView(updated ?? (await findEvent(event.id)));
      return { outcome: "settled", event: finalView };
    },

    /**
     * `checkout.session.expired` (`purchaseType: 'event_credits'`): libera el
     * checkout para que el organizador pueda abrir uno nuevo. A diferencia de
     * la versión anterior (B-1), esto YA NO ocurre con `payment_intent.payment_failed`
     * — Stripe Checkout deja reintentar con otra tarjeta en la MISMA Session
     * (el cliente ni siquiera sale de la página), así que un fallo de cobro no
     * implica que el importe congelado deje de proteger el precio. Solo esta
     * expiración real (24 h sin completar, o `startCheckout` expirándola a
     * propósito para reabrir) libera el hueco. Interna, invocada por el
     * webhook. Idempotente y tolerante a Sessions ya sustituidas.
     */
    async markCheckoutExpired(input: { eventId: string; sessionId: string }): Promise<void> {
      const event = await store.findEvent(input.eventId);
      if (!event || event.config.payment.checkoutRef !== input.sessionId) {
        // Ya se abrió un checkout nuevo (o el evento no existe): nada que liberar.
        return;
      }
      if (event.config.payment.purchaseId) {
        await store.markEventPurchaseFailed(event.config.payment.purchaseId);
      }
      await store.updateEvent(event.id, expected(event), {
        config: {
          ...event.config,
          payment: { ...event.config.payment, checkoutRef: null, purchaseId: null },
        },
      });
    },

    /**
     * `charge.refunded` (reembolso TOTAL, `purchaseType: 'event_credits'`,
     * B-5): marca el pago como reembolsado, lo que bloquea `activate` (ya no
     * `paymentSettled`) y la generación de más claves sobre un evento ya
     * activo (`AccessKeyService.generateKeys`). Los eventos no tienen
     * `Transfer` que revertir (specs/02 §1: el 100% es de la plataforma).
     * Interna, invocada por el webhook. `null` si no había compra `succeeded`
     * con esa referencia de pago (no es un evento, o ya estaba reembolsada).
     */
    async markRefunded(paymentIntentId: string): Promise<EventView | null> {
      const purchase = await store.findEventPurchaseByPaymentRef(paymentIntentId);
      if (!purchase || purchase.status !== "succeeded") return null;
      const refunded = await store.markEventPurchaseRefunded(purchase.id);
      if (!refunded) return null;
      const event = await findEvent(purchase.eventId);
      const updated = await store.updateEvent(event.id, expected(event), {
        config: { ...event.config, payment: { ...event.config.payment, status: "refunded" } },
      });
      return toEventView(updated ?? (await findEvent(event.id)));
    },

    /**
     * `POST /api/events/:id/activate` — `draft → active` si el pago está
     * saldado (autoventa o pagado; NUNCA si está reembolsado, B-5). La
     * generación de sesiones y claves es de 5.5.
     */
    async activate(actor: Actor, id: string): Promise<EventView> {
      const event = await findOwnEvent(actor, id);
      if (event.status !== "draft") throw notEditable();
      if (!paymentSettled(event.config)) {
        throw new EventError("PAYMENT_REQUIRED", "El evento está pendiente de pago");
      }
      const updated = await store.updateEvent(event.id, expected(event), { status: "active" });
      if (!updated) throw notEditable();
      return toEventView(updated);
    },
  };
}

export type EventService = ReturnType<typeof createEventService>;

// ── Implementaciones en memoria (tests y superficies sin base de datos) ────

type EventCheckoutInput = Parameters<PaymentGateway["createEventCheckout"]>[0];
type LicenseCheckoutInput = Parameters<PaymentGateway["createLicenseCheckout"]>[0];
type RoomCheckoutInput = Parameters<PaymentGateway["createRoomCheckout"]>[0];
type TransferInput = Parameters<PaymentGateway["createTransfer"]>[0];
type ReverseTransferInput = Parameters<PaymentGateway["reverseTransfer"]>[0];

/** Pasarela falsa: registra las llamadas y devuelve una URL/ref ficticia. Nunca toca Stripe. */
export function createFakePaymentGateway(): PaymentGateway & {
  calls: EventCheckoutInput[];
  licenseCalls: LicenseCheckoutInput[];
  roomCalls: RoomCheckoutInput[];
  transferCalls: TransferInput[];
  reversalCalls: ReverseTransferInput[];
  expiredRefs: string[];
} {
  const calls: EventCheckoutInput[] = [];
  const licenseCalls: LicenseCheckoutInput[] = [];
  const roomCalls: RoomCheckoutInput[] = [];
  const transferCalls: TransferInput[] = [];
  const reversalCalls: ReverseTransferInput[] = [];
  const expiredRefs: string[] = [];
  return {
    calls,
    licenseCalls,
    roomCalls,
    transferCalls,
    reversalCalls,
    expiredRefs,
    async createEventCheckout(input) {
      calls.push(input);
      const checkoutRef = `fake_cs_${calls.length}`;
      return { checkoutRef, url: `https://checkout.example.test/${checkoutRef}` };
    },
    async createLicenseCheckout(input) {
      licenseCalls.push(input);
      const checkoutRef = `fake_cs_license_${licenseCalls.length}`;
      return { checkoutRef, url: `https://checkout.example.test/${checkoutRef}` };
    },
    async createRoomCheckout(input) {
      roomCalls.push(input);
      const checkoutRef = `fake_cs_room_${roomCalls.length}`;
      return { checkoutRef, url: `https://checkout.example.test/${checkoutRef}` };
    },
    async expireCheckout(checkoutRef) {
      expiredRefs.push(checkoutRef);
    },
    async createTransfer(input) {
      transferCalls.push(input);
      return { transferId: `fake_tr_${transferCalls.length}` };
    },
    async reverseTransfer(input) {
      reversalCalls.push(input);
    },
  };
}

/** Store en memoria con la misma semántica que el de Prisma (copias profundas del JSONB). */
export function createInMemoryEventStore(opts: {
  adminIds?: Iterable<string>;
  roomVersions?: EventRoomVersionRef[];
  summaries?: Record<string, EventSummary>;
}): EventStore & { rows: EventRow[]; purchases: (EventPurchaseRef & { paymentRef: string | null })[] } {
  const admins = new Set(opts.adminIds ?? []);
  const versions = new Map((opts.roomVersions ?? []).map((v) => [v.roomVersionId, { ...v }]));
  const rows: EventRow[] = [];
  const purchases: (EventPurchaseRef & { paymentRef: string | null })[] = [];
  const copy = (e: EventRow): EventRow => structuredClone(e);
  const newer = (a: EventListCursor, b: EventListCursor) =>
    b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

  return {
    rows,
    purchases,
    async isAdmin(userId) {
      return admins.has(userId);
    },
    async findRoomVersion(id) {
      const v = versions.get(id);
      return v ? { ...v } : null;
    },
    async insertEvent(event) {
      const version = versions.get(event.roomVersionId);
      if (!version) throw new Error("roomVersion inexistente (FK)");
      const row: EventRow = {
        ...structuredClone(event),
        id: crypto.randomUUID(),
        roomId: version.roomId,
        status: "draft",
        version: 1,
        createdAt: new Date(),
      };
      rows.push(row);
      return copy(row);
    },
    async findEvent(id) {
      const row = rows.find((e) => e.id === id);
      return row ? copy(row) : null;
    },
    async updateEvent(id, expected, patch) {
      const row = rows.find((e) => e.id === id);
      if (!row || row.status !== expected.status || row.version !== expected.version) return null;
      for (const [k, v] of Object.entries(structuredClone(patch))) {
        if (v !== undefined) (row as Record<string, unknown>)[k] = v;
      }
      row.version += 1;
      return copy(row);
    },
    async listByOrganizer(organizerId, { limit, after }) {
      return rows
        .filter((e) => e.organizerId === organizerId)
        .filter((e) => after === null || newer(e, after) > 0)
        .sort(newer)
        .slice(0, limit)
        .map(copy);
    },
    async summarize(eventId) {
      return structuredClone(opts.summaries?.[eventId] ?? { sessions: 0, accessKeysByStatus: {} });
    },
    async insertEventPurchase(purchase) {
      purchases.push({
        id: purchase.id,
        eventId: purchase.eventId,
        amountCents: purchase.amountCents,
        currency: purchase.currency,
        status: "pending",
        paymentRef: purchase.checkoutRef,
      });
    },
    async findEventPurchase(purchaseId) {
      const row = purchases.find((p) => p.id === purchaseId);
      if (!row) return null;
      return { id: row.id, eventId: row.eventId, amountCents: row.amountCents, currency: row.currency, status: row.status };
    },
    async settleEventPurchase(purchaseId, paymentRef) {
      const row = purchases.find((p) => p.id === purchaseId);
      if (!row || row.status !== "pending") return false;
      row.status = "succeeded";
      row.paymentRef = paymentRef;
      return true;
    },
    async markEventPurchaseFailed(purchaseId) {
      const row = purchases.find((p) => p.id === purchaseId);
      if (row && row.status === "pending") row.status = "failed";
    },
    async findEventPurchaseByPaymentRef(paymentRef) {
      const row = purchases.find((p) => p.paymentRef === paymentRef);
      if (!row) return null;
      return { id: row.id, eventId: row.eventId, amountCents: row.amountCents, currency: row.currency, status: row.status };
    },
    async markEventPurchaseRefunded(purchaseId) {
      const row = purchases.find((p) => p.id === purchaseId);
      if (!row || row.status !== "succeeded") return false;
      row.status = "refunded";
      return true;
    },
  };
}
