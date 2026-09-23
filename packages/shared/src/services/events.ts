import { z } from "zod";
import { LOCALES, type Locale } from "@escaperoom/config/locales";
import { toReadableIssues, type ReadableIssue } from "../schemas/errors";
import { isAnonymous, type Actor } from "./actor";
import type { AdminDirectory } from "./admin";
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
 * - Evento ajeno: queda en `draft` con el pago pendiente. El checkout real es
 *   del ticket 5.1; aquí solo existe el puerto `PaymentGateway`.
 *
 * El estado del pago y los flags de vídeo/grabación viven en `event.config`
 * (JSONB, specs/12 §4), así que no hace falta migración.
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
export const MAX_EVENT_TITLE_LENGTH = 200;

/** Reglas de caducidad de claves, combinables (specs/02 §4.3). */
export type ExpiryRule =
  | { type: "hours_after_start"; startsAt: string; hours: number }
  | { type: "on_session_end" }
  | { type: "on_group_complete" };

/**
 * Estado del pago: `not_required` (autoventa), `pending` (evento ajeno aún sin
 * pagar) o `paid` (lo marca el webhook de 5.1 vía `markPaid`).
 */
export type EventPaymentStatus = "not_required" | "pending" | "paid";

/** Contenido de `event.config` (JSONB). */
export type EventConfig = {
  allowVideo: boolean;
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
    /** Referencia opaca del checkout abierto en la pasarela (5.1). */
    checkoutRef: string | null;
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
  createdAt: Date;
};

export type NewEventRow = Omit<EventRow, "id" | "createdAt" | "roomId" | "status">;

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
};

/** Resumen del detalle (specs/13 §6.1): nº de sesiones y nº de claves por estado. */
export type EventSummary = {
  sessions: number;
  accessKeysByStatus: Record<string, number>;
};

export type EventListCursor = { createdAt: Date; id: string };

/** Puerto de persistencia de eventos (ADR-022). */
export interface EventStore extends AdminDirectory {
  /** Versión + sala, ignorando salas borradas (`deletedAt`). */
  findRoomVersion(roomVersionId: string): Promise<EventRoomVersionRef | null>;
  insertEvent(event: NewEventRow): Promise<EventRow>;
  findEvent(id: string): Promise<EventRow | null>;
  /**
   * Aplica `patch` solo si el evento sigue en `expectedStatus` (escritura
   * condicional). `null` si ya no lo estaba o no existe.
   */
  updateEvent(id: string, expectedStatus: EventStatus, patch: EventPatch): Promise<EventRow | null>;
  /** Eventos del organizador, `createdAt DESC, id DESC`, estrictamente tras `after`. */
  listByOrganizer(
    organizerId: string,
    opts: { limit: number; after: EventListCursor | null },
  ): Promise<EventRow[]>;
  summarize(eventId: string): Promise<EventSummary>;
}

/**
 * Pasarela de pago (Stripe Checkout en 5.1). Ni 5.4 ni 5.10 la implementan:
 * web la cablea a `null` y los tests usan `createFakePaymentGateway`.
 */
export interface PaymentGateway {
  createEventCheckout(input: {
    eventId: string;
    organizerId: string;
    title: string;
    players: number;
    amountCents: number;
    currency: string;
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
   * Transferencia del reparto del creador tras el cobro ("separate charges
   * and transfers", specs/02 §2): NUNCA `application_fee_amount`, incompatible
   * con este modelo. `paymentIntentId` ata la transferencia al cargo original
   * (`source_transaction`) para que Stripe la financie con esos fondos.
   */
  createTransfer(input: {
    purchaseId: string;
    amountCents: number;
    currency: string;
    destinationAccountId: string;
    paymentIntentId: string;
  }): Promise<{ transferId: string }>;
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    /** Idioma de los emails de invitación (5.6). */
    locale: z.enum(LOCALES).optional(),
  })
  .strict()
  .refine((e) => !(e.recordingEnabled && e.audience === "educational"), RECORDING_EDUCATIONAL);

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
    locale: z.enum(LOCALES).optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: "No hay cambios que aplicar" });

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
};

export type EventDetail = EventView & { summary: EventSummary };

export type EventPage = { items: EventView[]; nextCursor: string | null };

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

/** Vista de un evento: precio recalculado desde su snapshot (nunca desde los tramos actuales). */
export function toEventView(event: EventRow): EventView {
  const quote = quotePricing(event.pricingSnapshot, event.playersPurchased);
  // Un evento siempre se crea con un precio válido: `null` solo si el JSONB se corrompió.
  const base = quote ?? {
    tierId: "",
    players: event.playersPurchased,
    unitPriceCents: 0,
    totalCents: 0,
    currency: event.pricingSnapshot.tiers[0]?.currency ?? "EUR",
  };
  return {
    ...event,
    pricing: {
      ...base,
      amountDueCents: event.config.selfSale ? 0 : base.totalCents,
      selfSale: event.config.selfSale,
    },
    activatable: event.status === "draft" && paymentSettled(event.config),
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
  /** `null` hasta que 5.1 cablee Stripe: el checkout responde `PAYMENT_GATEWAY_UNAVAILABLE`. */
  payments: PaymentGateway | null;
  now?: () => Date;
}) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());

  function requireUser(actor: Actor): void {
    if (isAnonymous(actor)) throw new EventError("UNAUTHORIZED", "No hay sesión");
  }

  async function findEvent(id: string): Promise<EventRow> {
    const event = UUID_RE.test(id) ? await store.findEvent(id) : null;
    if (!event) throw new EventError("NOT_FOUND", "Evento no encontrado");
    return event;
  }

  /** Solo el organizador (escrituras). */
  async function findOwnEvent(actor: Actor, id: string): Promise<EventRow> {
    requireUser(actor);
    const event = await findEvent(id);
    if (event.organizerId !== actor.userId) {
      throw new EventError("FORBIDDEN", "Solo el organizador puede gestionar este evento");
    }
    return event;
  }

  function notEditable(): EventError {
    return new EventError("EVENT_NOT_EDITABLE", "El evento ya no está en borrador");
  }

  return {
    /** Solo el guard de sesión (los adaptadores lo usan antes de leer el cuerpo). */
    authorize(actor: Actor): void {
      requireUser(actor);
    },

    /**
     * `POST /api/events` — valida `saleEvents`, congela los tramos vigentes y
     * calcula el total. Autoventa del autor: gratis y activable; si no, el
     * evento queda en `draft` con el pago pendiente.
     */
    async createEvent(actor: Actor, input: unknown): Promise<EventView> {
      requireUser(actor);
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
          ...(data.locale ? { locale: data.locale } : {}),
          payment: {
            status: selfSale ? "not_required" : "pending",
            checkoutRef: null,
            paidAt: null,
          },
        },
      });
      return toEventView(event);
    },

    /** `GET /api/events/:id` — organizador o admin de plataforma; incluye el resumen. */
    async getEvent(actor: Actor, id: string): Promise<EventDetail> {
      requireUser(actor);
      const event = await findEvent(id);
      if (event.organizerId !== actor.userId && !(await store.isAdmin(actor.userId))) {
        throw new EventError("FORBIDDEN", "Solo el organizador puede ver este evento");
      }
      return { ...toEventView(event), summary: await store.summarize(event.id) };
    },

    /** `GET /api/me/events` — eventos propios como organizador, paginados por cursor. */
    async listMyEvents(actor: Actor, query: unknown = {}): Promise<EventPage> {
      requireUser(actor);
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
     * (no con los tramos actuales) y solo se permite si no hay checkout abierto.
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
      if (data.playersPlanned !== undefined && data.playersPlanned !== event.playersPurchased) {
        if (event.config.payment.status === "paid" || event.config.payment.checkoutRef !== null) {
          throw new EventError(
            "EVENT_NOT_EDITABLE",
            "No se puede cambiar el nº de jugadores con un pago en curso o hecho",
          );
        }
        priceOrThrow(event.pricingSnapshot, data.playersPlanned);
      }

      const recordingTurnedOn = recordingEnabled && !event.config.recordingEnabled;
      const patch: EventPatch = {
        title: data.title,
        audience: data.audience,
        maxSimultaneousSessions: data.maxSimultaneousSessions,
        groupingMode: data.groupingMode,
        requireConfirmation: data.requireConfirmation,
        expiryRules: data.expiryRules,
        playersPurchased: data.playersPlanned,
        config: {
          ...event.config,
          allowVideo: data.allowVideo ?? event.config.allowVideo,
          recordingEnabled,
          recordingAcceptedAt: !recordingEnabled
            ? null
            : recordingTurnedOn
              ? now().toISOString()
              : event.config.recordingAcceptedAt,
          ...(data.locale ? { locale: data.locale } : {}),
        },
      };
      const updated = await store.updateEvent(event.id, "draft", patch);
      if (!updated) throw notEditable();
      return toEventView(updated);
    },

    /**
     * `POST /api/events/:id/checkout` — abre el pago por el total en la
     * pasarela. La autoventa no tiene checkout. El cobro real es de 5.1.
     */
    async startCheckout(
      actor: Actor,
      id: string,
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
      const view = toEventView(event);
      const checkout = await deps.payments.createEventCheckout({
        eventId: event.id,
        organizerId: event.organizerId,
        title: event.title,
        players: event.playersPurchased,
        amountCents: view.pricing.amountDueCents,
        currency: view.pricing.currency,
      });
      const updated = await store.updateEvent(event.id, "draft", {
        config: {
          ...event.config,
          payment: { ...event.config.payment, checkoutRef: checkout.checkoutRef },
        },
      });
      if (!updated) throw notEditable();
      return { event: toEventView(updated), checkoutUrl: checkout.url };
    },

    /**
     * Marca el pago como hecho. Interna, sin actor: la invocará el webhook de
     * Stripe de 5.1 tras verificar la firma. Idempotente.
     */
    async markPaid(id: string): Promise<EventView> {
      const event = await findEvent(id);
      if (event.config.payment.status !== "pending") return toEventView(event);
      const updated = await store.updateEvent(event.id, event.status, {
        config: {
          ...event.config,
          payment: { ...event.config.payment, status: "paid", paidAt: now().toISOString() },
        },
      });
      return toEventView(updated ?? (await findEvent(id)));
    },

    /**
     * `POST /api/events/:id/activate` — `draft → active` si el pago está
     * saldado (autoventa o pagado). La generación de sesiones y claves es de 5.5.
     */
    async activate(actor: Actor, id: string): Promise<EventView> {
      const event = await findOwnEvent(actor, id);
      if (event.status !== "draft") throw notEditable();
      if (!paymentSettled(event.config)) {
        throw new EventError("PAYMENT_REQUIRED", "El evento está pendiente de pago");
      }
      const updated = await store.updateEvent(event.id, "draft", { status: "active" });
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

/** Pasarela falsa: registra las llamadas y devuelve una URL/ref ficticia. Nunca toca Stripe. */
export function createFakePaymentGateway(): PaymentGateway & {
  calls: EventCheckoutInput[];
  licenseCalls: LicenseCheckoutInput[];
  roomCalls: RoomCheckoutInput[];
  transferCalls: TransferInput[];
} {
  const calls: EventCheckoutInput[] = [];
  const licenseCalls: LicenseCheckoutInput[] = [];
  const roomCalls: RoomCheckoutInput[] = [];
  const transferCalls: TransferInput[] = [];
  return {
    calls,
    licenseCalls,
    roomCalls,
    transferCalls,
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
    async createTransfer(input) {
      transferCalls.push(input);
      return { transferId: `fake_tr_${transferCalls.length}` };
    },
  };
}

/** Store en memoria con la misma semántica que el de Prisma (copias profundas del JSONB). */
export function createInMemoryEventStore(opts: {
  adminIds?: Iterable<string>;
  roomVersions?: EventRoomVersionRef[];
  summaries?: Record<string, EventSummary>;
}): EventStore & { rows: EventRow[] } {
  const admins = new Set(opts.adminIds ?? []);
  const versions = new Map((opts.roomVersions ?? []).map((v) => [v.roomVersionId, { ...v }]));
  const rows: EventRow[] = [];
  const copy = (e: EventRow): EventRow => structuredClone(e);
  const newer = (a: EventListCursor, b: EventListCursor) =>
    b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

  return {
    rows,
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
        createdAt: new Date(),
      };
      rows.push(row);
      return copy(row);
    },
    async findEvent(id) {
      const row = rows.find((e) => e.id === id);
      return row ? copy(row) : null;
    },
    async updateEvent(id, expectedStatus, patch) {
      const row = rows.find((e) => e.id === id);
      if (!row || row.status !== expectedStatus) return null;
      for (const [k, v] of Object.entries(structuredClone(patch))) {
        if (v !== undefined) (row as Record<string, unknown>)[k] = v;
      }
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
  };
}
