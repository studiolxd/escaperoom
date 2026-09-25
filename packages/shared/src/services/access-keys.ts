import { randomBytes } from "node:crypto";
import { z } from "zod";
import { toReadableIssues, type ReadableIssue } from "../schemas/errors";
import { type Actor } from "./actor";
import { UUID_RE, requireUser } from "./common";
import type { EventRow, EventService, EventStatus, EventStore, EventView } from "./events";
import type { DpaGate } from "./organizations";

/**
 * Claves de acceso de un evento (ticket 5.5, specs/02 §4, specs/13 §6.2, specs/14 §6).
 *
 * - **Tipos** (specs/02 §4.1): `individual` y `batch` conceden un asiento y mueren al
 *   canjearse; `group` y `rotating` son un código compartido para N asientos
 *   (`seats`), que muere al agotarlos. Solo la rotativa se regenera: la vieja
 *   caduca y la nueva hereda su asignación y los asientos que quedaban
 *   (`regeneratedFrom`).
 * - **Límite**: la suma de `seats` de las claves de un evento nunca supera
 *   `playersPurchased` (el store lo comprueba bajo bloqueo de la fila del evento).
 * - **Estados** (specs/02 §4.2): sin confirmación obligatoria las claves nacen
 *   `active`; con ella nacen `generated` y 5.6 las lleva por `sent →
 *   pending_confirmation → confirmed`. Se pueden canjear en `confirmed` o `active`.
 * - **Caducidad** (specs/02 §4.3): `hours_after_start` se sella en `expiresAt` al
 *   generar; `on_session_end` y `on_group_complete` las aplica el job de
 *   `@escaperoom/worker` con `expireAccessKeys`.
 * - **DPA** (5.11, specs/18 §3.1): generar claves con `emails` (o activar con un
 *   plan que los lleve) exige que la organización activa del actor tenga el DPA
 *   vigente firmado (`DPA_REQUIRED`); sin email no hay PII y no se exige.
 * - **Canje** (5.8): `checkRedeemable` + `applyRedemption` son la función de estado
 *   pura y `consumeSeat` la escritura condicional que la usa; con sesión, el
 *   store comprueba el aforo bajo bloqueo de la fila de la sesión (`redeemSeat`).
 *   La asignación por `groupingMode` y el `joinToken` viven en `redeem.ts`.
 */

// ── Tipos de dominio ───────────────────────────────────────────────────────

export const ACCESS_KEY_TYPES = ["individual", "rotating", "group", "batch"] as const;
export type AccessKeyType = (typeof ACCESS_KEY_TYPES)[number];

export const ACCESS_KEY_STATUSES = [
  "generated",
  "sent",
  "pending_confirmation",
  "confirmed",
  "active",
  "used",
  "expired",
] as const;
export type AccessKeyStatus = (typeof ACCESS_KEY_STATUSES)[number];

/** Estados de una clave que aún no ha muerto (puede caducar, rotar o canjearse más adelante). */
export const LIVE_ACCESS_KEY_STATUSES: readonly AccessKeyStatus[] = [
  "generated",
  "sent",
  "pending_confirmation",
  "confirmed",
  "active",
];
/** Estados desde los que se puede canjear un asiento (specs/02 §4.2 y §4.5). */
export const REDEEMABLE_ACCESS_KEY_STATUSES: readonly AccessKeyStatus[] = ["confirmed", "active"];

export function isLiveAccessKey(status: AccessKeyStatus): boolean {
  return LIVE_ACCESS_KEY_STATUSES.includes(status);
}

/** Tipos de un solo asiento que mueren al primer canje. */
const SINGLE_USE_TYPES: ReadonlySet<AccessKeyType> = new Set(["individual", "batch"]);

/** Tope de claves por petición de generación (una petición = una transacción). */
export const MAX_KEYS_PER_REQUEST = 1000;
/** Tope de asientos de una clave compartida (el aforo real lo pone la sesión, 5.8). */
export const MAX_SEATS_PER_KEY = 10_000;
/** Tope de líneas del plan de claves al activar. */
export const MAX_KEY_PLAN_ITEMS = 20;

/** Fila de `accessKey`. */
export type AccessKeyRow = {
  code: string;
  eventId: string;
  sessionId: string | null;
  groupId: string | null;
  email: string | null;
  keyType: AccessKeyType;
  status: AccessKeyStatus;
  singleUse: boolean;
  requireConfirmation: boolean;
  regeneratedFrom: string | null;
  /** Asientos que concede (1 en individual/batch). Tras rotar, la vieja se queda con los canjeados. */
  seats: number;
  redeemedCount: number;
  /** Último envío correcto del email de invitación (5.6); `null` si nunca salió. */
  sentAt: Date | null;
  confirmedAt: Date | null;
  activatedAt: Date | null;
  usedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
};

/** Campos mutables de una clave. */
export type AccessKeyPatch = Partial<
  Pick<
    AccessKeyRow,
    | "status"
    | "seats"
    | "redeemedCount"
    | "sessionId"
    | "groupId"
    | "sentAt"
    | "confirmedAt"
    | "activatedAt"
    | "usedAt"
  >
>;

/** Sesión de partida (`gameSession`) tal como la ve este servicio. */
export type GameSessionRef = {
  id: string;
  eventId: string;
  name: string;
  capacity: number;
  status: "pending" | "in_progress" | "ended" | "aborted";
};

/** Grupo con el evento de su sesión (join). */
export type GroupRef = { id: string; sessionId: string; eventId: string };

/** Estados de sesión que aún admiten jugadores. */
export const OPEN_SESSION_STATUSES: readonly GameSessionRef["status"][] = [
  "pending",
  "in_progress",
];

/** Sesión con su ocupación: Σ `redeemedCount` de las claves asignadas a ella. */
export type SessionSeats = GameSessionRef & { occupied: number };

/** Grupo de una sesión con su ocupación (Σ `redeemedCount` de sus claves). */
export type GroupSeats = { id: string; sessionId: string; name: string; occupied: number };

/** Sesión y grupo en los que cae un canje (`null` = sin asignar). */
export type SeatAssignment = { sessionId: string | null; groupId: string | null };

/** Resultado de un canje con aforo: la sesión estaba llena o la clave cambió. */
export type RedeemSeatResult =
  { ok: true; key: AccessKeyRow } | { ok: false; reason: "CONFLICT" | "SESSION_FULL" };

export type AccessKeyListCursor = { createdAt: Date; code: string };

/** Resultado de una inserción de claves bajo el límite de asientos del evento. */
export type InsertKeysResult =
  | { ok: true; keys: AccessKeyRow[] }
  | { ok: false; reason: "SEAT_LIMIT"; committedSeats: number }
  | { ok: false; reason: "CODE_COLLISION" };

export type RotateKeyResult =
  { ok: true; key: AccessKeyRow } | { ok: false; reason: "CONFLICT" | "CODE_COLLISION" };

/** Condición de una escritura condicional sobre una clave. */
export type AccessKeyExpectation = { status: AccessKeyStatus; redeemedCount: number };

/** Claves que caducó cada regla en una pasada del job. */
export type ExpirySweepResult = {
  hoursAfterStart: number;
  onSessionEnd: number;
  onGroupComplete: number;
};

/** Puerto de persistencia de claves (ADR-022). */
export interface AccessKeyStore {
  findEvent(eventId: string): Promise<EventRow | null>;
  listSessions(eventId: string): Promise<GameSessionRef[]>;
  insertSessions(
    eventId: string,
    sessions: Array<{ name: string; capacity: number }>,
  ): Promise<GameSessionRef[]>;
  findGroup(groupId: string): Promise<GroupRef | null>;
  /** Códigos de `codes` que ya existen (en cualquier evento). */
  codesInUse(codes: string[]): Promise<Set<string>>;
  /** Suma de `seats` de las claves del evento. */
  committedSeats(eventId: string): Promise<number>;
  /**
   * Inserta `rows` solo si `committedSeats + Σ seats ≤ seatLimit`, de forma
   * atómica respecto a otras generaciones del mismo evento.
   */
  insertKeys(eventId: string, seatLimit: number, rows: AccessKeyRow[]): Promise<InsertKeysResult>;
  findKey(code: string): Promise<AccessKeyRow | null>;
  /** Claves del evento, `createdAt ASC, code ASC`, estrictamente tras `after`. */
  listKeys(
    eventId: string,
    opts: { limit: number; after: AccessKeyListCursor | null; status: AccessKeyStatus | null },
  ): Promise<AccessKeyRow[]>;
  /** Aplica `patch` solo si la clave sigue como se leyó. `null` si cambió o no existe. */
  updateKey(
    code: string,
    expected: AccessKeyExpectation,
    patch: AccessKeyPatch,
  ): Promise<AccessKeyRow | null>;
  /** Rotación atómica: parchea la vieja (condicional) e inserta la nueva. */
  rotateKey(
    code: string,
    expected: AccessKeyExpectation,
    oldPatch: AccessKeyPatch,
    replacement: AccessKeyRow,
  ): Promise<RotateKeyResult>;
  /** Sesiones del evento (mismo orden que `listSessions`) con su ocupación. */
  listSessionSeats(eventId: string): Promise<SessionSeats[]>;
  /** Grupos de la sesión (por creación) con su ocupación. */
  listGroupSeats(sessionId: string): Promise<GroupSeats[]>;
  /**
   * Canje con aforo: con la sesión bloqueada, si está abierta y
   * `ocupación + 1 ≤ capacity`, aplica `patch` solo si la clave sigue como se
   * leyó. Dos canjes simultáneos de la última plaza: uno gana y el otro
   * recibe `SESSION_FULL`.
   */
  redeemSeat(
    code: string,
    expected: AccessKeyExpectation,
    patch: AccessKeyPatch,
    sessionId: string,
  ): Promise<RedeemSeatResult>;
  /** `hours_after_start`: caduca las claves vivas con `expiresAt <= now`. */
  expireByDeadline(now: Date): Promise<number>;
  /** `on_session_end`: claves vivas de sesiones `ended` en eventos con esa regla. */
  expireBySessionEnd(): Promise<number>;
  /** `on_group_complete`: claves vivas de grupos con `completedAt` en eventos con esa regla. */
  expireByGroupComplete(): Promise<number>;
}

// ── Errores ────────────────────────────────────────────────────────────────

export type AccessKeyErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "EVENT_NOT_ACTIVE"
  | "EVENT_EXPIRED"
  | "SEAT_LIMIT_EXCEEDED"
  | "ACCESS_KEY_NOT_ROTATING"
  | "ACCESS_KEY_INVALID"
  | "ACCESS_KEY_USED"
  | "ACCESS_KEY_EXPIRED"
  | "ACCESS_KEY_NOT_CONFIRMED"
  | "SESSION_FULL"
  | "SESSION_REQUIRED"
  | "ACCESS_KEY_NO_EMAIL"
  | "DPA_REQUIRED"
  | "CONFIRMATION_INVALID"
  | "CONFIRMATION_EXPIRED"
  | "CONFIRMATION_UNAVAILABLE"
  | "CONFLICT";

/** Error de dominio de claves; los adaptadores lo traducen a HTTP/tRPC/MCP. */
export class AccessKeyError extends Error {
  readonly code: AccessKeyErrorCode;
  readonly issues: ReadableIssue[];
  /** Datos extra para el cliente (p. ej. las sesiones elegibles de `SESSION_REQUIRED`). */
  readonly details: Record<string, unknown> | undefined;
  constructor(
    code: AccessKeyErrorCode,
    message: string,
    issues: ReadableIssue[] = [],
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AccessKeyError";
    this.code = code;
    this.issues = issues;
    this.details = details;
  }
}

function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AccessKeyError(
      "VALIDATION_ERROR",
      "Datos no válidos",
      toReadableIssues(parsed.error),
    );
  }
  return parsed.data;
}

// ── Códigos ────────────────────────────────────────────────────────────────

/**
 * Alfabeto sin caracteres ambiguos al leer o dictar una tarjeta impresa: fuera
 * `0/O`, `1/I/L`. 31 símbolos.
 */
export const ACCESS_KEY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_BLOCKS = 3;
const CODE_BLOCK_LENGTH = 4;
/** 12 símbolos de 31 ≈ 59,4 bits: adivinar una clave viva es inviable aun con millones de claves. */
export const ACCESS_KEY_CODE_LENGTH = CODE_BLOCKS * CODE_BLOCK_LENGTH;
/** Formato canónico `XXXX-XXXX-XXXX`. */
export const ACCESS_KEY_CODE_RE = new RegExp(
  `^[${ACCESS_KEY_ALPHABET}]{${CODE_BLOCK_LENGTH}}(-[${ACCESS_KEY_ALPHABET}]{${CODE_BLOCK_LENGTH}}){${CODE_BLOCKS - 1}}$`,
);

/** Fuente de aleatoriedad inyectable (tests de colisión); por defecto CSPRNG. */
export type RandomBytes = (size: number) => Uint8Array;

/**
 * Genera un código `XXXX-XXXX-XXXX` con aleatoriedad criptográfica y muestreo
 * por rechazo (sin sesgo de módulo: solo se aceptan bytes < 248 = 8 × 31).
 */
export function generateAccessKeyCode(random: RandomBytes = randomBytes): string {
  const n = ACCESS_KEY_ALPHABET.length;
  const limit = 256 - (256 % n);
  const chars: string[] = [];
  while (chars.length < ACCESS_KEY_CODE_LENGTH) {
    for (const byte of random(ACCESS_KEY_CODE_LENGTH * 2)) {
      if (byte < limit) chars.push(ACCESS_KEY_ALPHABET[byte % n]!);
      if (chars.length === ACCESS_KEY_CODE_LENGTH) break;
    }
  }
  const blocks: string[] = [];
  for (let i = 0; i < CODE_BLOCKS; i++) {
    blocks.push(chars.slice(i * CODE_BLOCK_LENGTH, (i + 1) * CODE_BLOCK_LENGTH).join(""));
  }
  return blocks.join("-");
}

/**
 * Normaliza lo que teclea una persona (minúsculas, espacios, guiones o sin
 * ellos) al formato canónico. `null` si no puede ser una clave.
 */
export function normalizeAccessKeyCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[\s-]/g, "");
  if (raw.length !== ACCESS_KEY_CODE_LENGTH) return null;
  const blocks = raw.match(new RegExp(`.{${CODE_BLOCK_LENGTH}}`, "g")) ?? [];
  const code = blocks.join("-");
  return ACCESS_KEY_CODE_RE.test(code) ? code : null;
}

// ── Función de estado (canje, 5.8) ─────────────────────────────────────────

export type RedeemCheck =
  | { ok: true }
  | {
      ok: false;
      code: "ACCESS_KEY_USED" | "ACCESS_KEY_EXPIRED" | "ACCESS_KEY_NOT_CONFIRMED";
    };

/** ¿Se puede canjear un asiento de esta clave en `now`? (specs/13 §6.2, códigos de error). */
export function checkRedeemable(key: AccessKeyRow, now: Date): RedeemCheck {
  if (key.status === "used") return { ok: false, code: "ACCESS_KEY_USED" };
  if (key.status === "expired") return { ok: false, code: "ACCESS_KEY_EXPIRED" };
  if (key.expiresAt !== null && key.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, code: "ACCESS_KEY_EXPIRED" };
  }
  if (!REDEEMABLE_ACCESS_KEY_STATUSES.includes(key.status)) {
    return { ok: false, code: "ACCESS_KEY_NOT_CONFIRMED" };
  }
  return { ok: true };
}

/**
 * Canje de un asiento (presupone `checkRedeemable` ok). La clave de un asiento
 * pasa a `used`; una compartida sigue `active` hasta agotar sus asientos.
 */
export function applyRedemption(key: AccessKeyRow, now: Date): AccessKeyPatch {
  const redeemedCount = key.redeemedCount + 1;
  const exhausted = key.singleUse || redeemedCount >= key.seats;
  return {
    redeemedCount,
    status: exhausted ? "used" : "active",
    activatedAt: key.activatedAt ?? now,
    usedAt: exhausted ? now : null,
  };
}

// ── Esquemas de entrada ────────────────────────────────────────────────────

const uuid = z.string().regex(UUID_RE, "UUID no válido");

const keyRequestShape = {
  type: z.enum(ACCESS_KEY_TYPES),
  count: z.number().int().min(1).max(MAX_KEYS_PER_REQUEST).optional(),
  /** Asientos por clave: obligatorio en `group`/`rotating`, 1 en `individual`/`batch`. */
  seats: z.number().int().min(1).max(MAX_SEATS_PER_KEY).optional(),
  emails: z.array(z.email()).min(1).max(MAX_KEYS_PER_REQUEST).optional(),
};

type KeyRequestLike = {
  type: AccessKeyType;
  count?: number | undefined;
  seats?: number | undefined;
  emails?: string[] | undefined;
};

function refineKeyRequest(req: KeyRequestLike, ctx: z.RefinementCtx): void {
  const shared = req.type === "group" || req.type === "rotating";
  if (shared && req.seats === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["seats"],
      message: "Las claves de grupo y rotativas necesitan el nº de asientos",
    });
  }
  if (!shared && req.seats !== undefined && req.seats !== 1) {
    ctx.addIssue({
      code: "custom",
      path: ["seats"],
      message: "Las claves individuales y de lote conceden un solo asiento",
    });
  }
  if (req.count === undefined && req.emails === undefined) {
    ctx.addIssue({ code: "custom", path: ["count"], message: "Indica count o emails" });
  }
  if (req.count !== undefined && req.emails !== undefined && req.count !== req.emails.length) {
    ctx.addIssue({
      code: "custom",
      path: ["count"],
      message: "count debe coincidir con el nº de emails",
    });
  }
  if (req.emails && new Set(req.emails.map((e) => e.toLowerCase())).size !== req.emails.length) {
    ctx.addIssue({ code: "custom", path: ["emails"], message: "Hay emails repetidos" });
  }
}

/**
 * Cuerpo de `POST /api/events/:id/access-keys` (specs/13 §6.2). `sessionId` /
 * `groupId` preasignan la clave (solo en `groupingMode: specific`).
 */
export const GenerateAccessKeysInput = z
  .object({ ...keyRequestShape, sessionId: uuid.optional(), groupId: uuid.optional() })
  .strict()
  .superRefine(refineKeyRequest);

/** Línea del plan de claves al activar: aún no hay sesiones, así que sin preasignación. */
const KeyPlanItem = z.object(keyRequestShape).strict().superRefine(refineKeyRequest);

/** Cuerpo (opcional) de `POST /api/events/:id/activate`. */
export const ActivateEventInput = z
  .object({ keyPlan: z.array(KeyPlanItem).min(1).max(MAX_KEY_PLAN_ITEMS).optional() })
  .strict();

export const ListAccessKeysQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(ACCESS_KEY_STATUSES).optional(),
});

// ── Vistas ─────────────────────────────────────────────────────────────────

export type SeatUsage = { purchased: number; committed: number; available: number };

export type AccessKeyPage = {
  items: AccessKeyRow[];
  nextCursor: string | null;
  seats: SeatUsage;
};

export type ActivationResult = {
  event: EventView;
  sessions: GameSessionRef[];
  keys: AccessKeyRow[];
};

function encodeCursor(c: AccessKeyListCursor): string {
  return Buffer.from(JSON.stringify([c.createdAt.toISOString(), c.code])).toString("base64url");
}

function decodeCursor(raw: string): AccessKeyListCursor {
  try {
    const [at, code] = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown[];
    const createdAt = new Date(String(at));
    if (
      typeof code === "string" &&
      ACCESS_KEY_CODE_RE.test(code) &&
      !Number.isNaN(createdAt.getTime())
    ) {
      return { createdAt, code };
    }
  } catch {
    // cae al error de abajo
  }
  throw new AccessKeyError("VALIDATION_ERROR", "Cursor no válido", [
    { path: "cursor", message: "Cursor no válido" },
  ]);
}

/** Caducidad por jornada (`hours_after_start`) sellada en la clave; `null` si el evento no la usa. */
export function keyDeadline(event: Pick<EventRow, "expiryRules">): Date | null {
  const rule = event.expiryRules.find((r) => r.type === "hours_after_start");
  if (!rule) return null;
  return new Date(new Date(rule.startsAt).getTime() + rule.hours * 3_600_000);
}

/** Sesiones que se crean al activar: `maxSimultaneousSessions`, aforo repartido a partes iguales. */
export function defaultSessions(
  event: Pick<EventRow, "maxSimultaneousSessions" | "playersPurchased">,
): Array<{ name: string; capacity: number }> {
  const n = event.maxSimultaneousSessions;
  // `gameSession.capacity` es smallint.
  const capacity = Math.min(Math.ceil(event.playersPurchased / n), 32_767);
  return Array.from({ length: n }, (_, i) => ({ name: `Sesión ${i + 1}`, capacity }));
}

/** Intentos ante colisión de códigos (con 59 bits, una sola ya es improbable). */
const MAX_CODE_ATTEMPTS = 5;

// ── Servicio ───────────────────────────────────────────────────────────────

/**
 * Pasada del job de caducidad (specs/02 §4.3). No necesita actor ni el resto
 * del servicio: el worker la invoca directamente sobre el store.
 */
export async function expireAccessKeys(
  store: Pick<AccessKeyStore, "expireByDeadline" | "expireBySessionEnd" | "expireByGroupComplete">,
  now: Date,
): Promise<ExpirySweepResult> {
  const hoursAfterStart = await store.expireByDeadline(now);
  const onSessionEnd = await store.expireBySessionEnd();
  const onGroupComplete = await store.expireByGroupComplete();
  return { hoursAfterStart, onSessionEnd, onGroupComplete };
}

export function createAccessKeyService(deps: {
  store: AccessKeyStore;
  /** `activate` de 5.4 (organizador, pago saldado, `draft → active`). */
  events: Pick<EventService, "activate">;
  /** DPA de la organización (5.11): obligatorio antes de tratar emails de participantes. */
  dpa: DpaGate;
  now?: () => Date;
  random?: RandomBytes;
}) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const newCode = () => generateAccessKeyCode(deps.random);

  /** Solo el organizador gestiona las claves de su evento. */
  async function findOwnEvent(actor: Actor, eventId: string): Promise<EventRow> {
    requireUser(actor, AccessKeyError);
    const event = UUID_RE.test(eventId) ? await store.findEvent(eventId) : null;
    if (!event) throw new AccessKeyError("NOT_FOUND", "Evento no encontrado");
    if (event.organizerId !== actor.userId) {
      throw new AccessKeyError("FORBIDDEN", "Solo el organizador gestiona las claves del evento");
    }
    return event;
  }

  /** Claves con email = PII de participantes tratada por encargo: exige el DPA (5.11). */
  async function requireDpaFor(actor: Actor, requests: KeyRequestLike[]): Promise<void> {
    if (requests.some((req) => req.emails !== undefined)) await deps.dpa.requireDpa(actor);
  }

  function requireStatus(event: EventRow, status: EventStatus): void {
    if (event.status !== status) {
      throw new AccessKeyError("EVENT_NOT_ACTIVE", "El evento no está activo");
    }
  }

  /**
   * B-5: un evento reembolsado (pago total devuelto tras `charge.refunded`)
   * no debe poder generar más claves aunque ya estuviera `active` cuando se
   * reembolsó — `EventService.activate` ya bloquea llegar a `active` desde
   * `draft` con el pago reembolsado, pero no revierte un evento que ya lo
   * estaba antes del reembolso.
   */
  function assertPaymentNotRefunded(event: EventRow): void {
    if (event.config.payment.status === "refunded") {
      throw new AccessKeyError(
        "CONFLICT",
        "El pago del evento ha sido reembolsado; no se pueden generar más claves",
      );
    }
  }

  function assertNotExpired(event: EventRow): void {
    const deadline = keyDeadline(event);
    if (deadline && deadline.getTime() <= now().getTime()) {
      throw new AccessKeyError("EVENT_EXPIRED", "La jornada del evento ya ha caducado");
    }
  }

  function seatsOf(req: KeyRequestLike): number {
    const count = req.emails?.length ?? req.count ?? 0;
    return count * (SINGLE_USE_TYPES.has(req.type) ? 1 : (req.seats ?? 1));
  }

  function seatLimitError(requested: number, committed: number, purchased: number) {
    const available = Math.max(0, purchased - committed);
    return new AccessKeyError(
      "SEAT_LIMIT_EXCEEDED",
      `Se piden ${requested} asientos y quedan ${available} de ${purchased} comprados`,
    );
  }

  /** Filas nuevas (sin código aún) de una petición de generación. */
  function buildRows(
    event: EventRow,
    req: KeyRequestLike,
    assignment: { sessionId: string | null; groupId: string | null },
  ): Array<Omit<AccessKeyRow, "code">> {
    const at = now();
    const singleUse = SINGLE_USE_TYPES.has(req.type);
    const active = !event.requireConfirmation;
    const emails: Array<string | null> =
      req.emails ?? Array.from({ length: req.count ?? 0 }, () => null);
    return emails.map((email) => ({
      eventId: event.id,
      sessionId: assignment.sessionId,
      groupId: assignment.groupId,
      email,
      keyType: req.type,
      // Sin confirmación obligatoria se salta directo a `active` (specs/02 §4.4).
      status: active ? "active" : "generated",
      singleUse,
      requireConfirmation: event.requireConfirmation,
      regeneratedFrom: null,
      seats: singleUse ? 1 : (req.seats ?? 1),
      redeemedCount: 0,
      sentAt: null,
      confirmedAt: null,
      activatedAt: active ? at : null,
      usedAt: null,
      expiresAt: keyDeadline(event),
      createdAt: at,
    }));
  }

  /** `n` códigos únicos: sin repetirse en el lote ni con los ya existentes. */
  async function uniqueCodes(n: number): Promise<string[]> {
    const codes = new Set<string>();
    while (codes.size < n) codes.add(newCode());
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const taken = await store.codesInUse([...codes]);
      if (taken.size === 0) break;
      for (const code of taken) {
        codes.delete(code);
        let fresh = newCode();
        while (codes.has(fresh)) fresh = newCode();
        codes.add(fresh);
      }
    }
    return [...codes];
  }

  async function withCodes(rows: Array<Omit<AccessKeyRow, "code">>): Promise<AccessKeyRow[]> {
    const codes = await uniqueCodes(rows.length);
    return rows.map((row, i) => ({ ...row, code: codes[i]! }));
  }

  /** Inserta las claves bajo el límite de asientos, reintentando si choca un código. */
  async function insert(
    event: EventRow,
    rows: Array<Omit<AccessKeyRow, "code">>,
  ): Promise<AccessKeyRow[]> {
    const requested = rows.reduce((sum, r) => sum + r.seats, 0);
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const result = await store.insertKeys(
        event.id,
        event.playersPurchased,
        await withCodes(rows),
      );
      if (result.ok) return result.keys;
      if (result.reason === "SEAT_LIMIT") {
        throw seatLimitError(requested, result.committedSeats, event.playersPurchased);
      }
    }
    throw new AccessKeyError("CONFLICT", "No se pudieron generar códigos únicos; reinténtalo");
  }

  /** Valida `sessionId`/`groupId` contra el evento y su modo de agrupación. */
  async function resolveAssignment(
    event: EventRow,
    input: { sessionId?: string | undefined; groupId?: string | undefined },
  ): Promise<{ sessionId: string | null; groupId: string | null }> {
    if (input.sessionId === undefined && input.groupId === undefined) {
      return { sessionId: null, groupId: null };
    }
    if (event.groupingMode !== "specific") {
      // En `random`/`free` la sesión se decide al canjear (5.8).
      throw new AccessKeyError("VALIDATION_ERROR", "Datos no válidos", [
        {
          path: input.sessionId === undefined ? "groupId" : "sessionId",
          message: "Solo se preasigna sesión o grupo en eventos con agrupación específica",
        },
      ]);
    }
    let sessionId = input.sessionId ?? null;
    if (input.groupId !== undefined) {
      const group = await store.findGroup(input.groupId);
      if (!group || group.eventId !== event.id || (sessionId && group.sessionId !== sessionId)) {
        throw new AccessKeyError("VALIDATION_ERROR", "Datos no válidos", [
          { path: "groupId", message: "El grupo no pertenece a esta sesión del evento" },
        ]);
      }
      sessionId = group.sessionId;
    }
    const sessions = await store.listSessions(event.id);
    if (!sessions.some((s) => s.id === sessionId)) {
      throw new AccessKeyError("VALIDATION_ERROR", "Datos no válidos", [
        { path: "sessionId", message: "La sesión no pertenece al evento" },
      ]);
    }
    return { sessionId, groupId: input.groupId ?? null };
  }

  async function findOwnKey(actor: Actor, rawCode: string): Promise<AccessKeyRow> {
    requireUser(actor, AccessKeyError);
    const code = normalizeAccessKeyCode(rawCode);
    const key = code ? await store.findKey(code) : null;
    if (!key) throw new AccessKeyError("NOT_FOUND", "Clave no encontrada");
    const event = await store.findEvent(key.eventId);
    if (!event || event.organizerId !== actor.userId) {
      throw new AccessKeyError("FORBIDDEN", "Solo el organizador gestiona las claves del evento");
    }
    return key;
  }

  return {
    /** Solo el guard de sesión (los adaptadores lo usan antes de leer el cuerpo). */
    authorize(actor: Actor): void {
      requireUser(actor, AccessKeyError);
    },

    /** Puerta del DPA (5.11) para quien envía emails sobre claves ya generadas (5.6). */
    requireDpa(actor: Actor): Promise<void> {
      return deps.dpa.requireDpa(actor);
    },

    /**
     * `POST /api/events/:id/activate` — `draft → active` (5.4) y, a partir de ahí,
     * crea las sesiones (`maxSimultaneousSessions`) y genera las claves del
     * `keyPlan`. Sin plan: `playersPurchased` claves individuales. El plan se
     * valida contra lo comprado ANTES de activar, para no dejar el evento activo
     * con una generación imposible.
     */
    async activateEvent(
      actor: Actor,
      eventId: string,
      input: unknown = {},
    ): Promise<ActivationResult> {
      const event = await findOwnEvent(actor, eventId);
      const { keyPlan } = parseOrThrow(ActivateEventInput, input ?? {});
      const plan: KeyRequestLike[] = keyPlan ?? [
        { type: "individual", count: event.playersPurchased },
      ];
      const requested = plan.reduce((sum, req) => sum + seatsOf(req), 0);
      if (requested > event.playersPurchased) {
        throw seatLimitError(requested, 0, event.playersPurchased);
      }
      assertNotExpired(event);
      // Antes de activar: no dejar el evento activo con un plan que no se puede generar.
      await requireDpaFor(actor, plan);

      const view = await deps.events.activate(actor, eventId);
      const active: EventRow = { ...event, status: view.status };

      const existing = await store.listSessions(event.id);
      const sessions =
        existing.length > 0
          ? existing
          : await store.insertSessions(event.id, defaultSessions(event));
      const rows = plan.flatMap((req) =>
        buildRows(active, req, { sessionId: null, groupId: null }),
      );
      const keys: AccessKeyRow[] = [];
      // Por tandas: cada inserción es una transacción acotada.
      for (let i = 0; i < rows.length; i += MAX_KEYS_PER_REQUEST) {
        keys.push(...(await insert(active, rows.slice(i, i + MAX_KEYS_PER_REQUEST))));
      }
      return { event: view, sessions, keys };
    },

    /**
     * `POST /api/events/:id/access-keys` — generación a demanda dentro de lo
     * comprado (evento `active`). Con `emails`, una clave por correo (el envío es 5.6).
     */
    async generateKeys(actor: Actor, eventId: string, input: unknown): Promise<AccessKeyRow[]> {
      const event = await findOwnEvent(actor, eventId);
      const data = parseOrThrow(GenerateAccessKeysInput, input);
      await requireDpaFor(actor, [data]);
      requireStatus(event, "active");
      assertPaymentNotRefunded(event);
      assertNotExpired(event);
      const assignment = await resolveAssignment(event, data);
      return insert(event, buildRows(event, data, assignment));
    },

    /** `GET /api/events/:id/access-keys` — listado paginado con estado y asientos. */
    async listKeys(actor: Actor, eventId: string, query: unknown = {}): Promise<AccessKeyPage> {
      const event = await findOwnEvent(actor, eventId);
      const { cursor, limit, status } = parseOrThrow(ListAccessKeysQuery, query);
      const [rows, committed] = await Promise.all([
        store.listKeys(event.id, {
          limit: limit + 1,
          after: cursor === undefined ? null : decodeCursor(cursor),
          status: status ?? null,
        }),
        store.committedSeats(event.id),
      ]);
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return {
        items,
        nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
        seats: {
          purchased: event.playersPurchased,
          committed,
          available: Math.max(0, event.playersPurchased - committed),
        },
      };
    },

    /**
     * `POST /api/access-keys/:code/regenerate` — solo rotativas vivas. La vieja
     * caduca quedándose con los asientos ya canjeados; la nueva hereda sesión,
     * grupo, email, caducidad y el resto de asientos, con `regeneratedFrom`.
     */
    async regenerateKey(actor: Actor, rawCode: string): Promise<AccessKeyRow> {
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
        const key = await findOwnKey(actor, rawCode);
        if (key.keyType !== "rotating") {
          throw new AccessKeyError("ACCESS_KEY_NOT_ROTATING", "Solo se regeneran claves rotativas");
        }
        if (key.status === "used") {
          throw new AccessKeyError("ACCESS_KEY_USED", "La clave ya agotó sus asientos");
        }
        if (key.status === "expired") {
          throw new AccessKeyError("ACCESS_KEY_EXPIRED", "La clave ya no es válida");
        }
        const [code] = await uniqueCodes(1);
        // Un código ya enviado por email deja de valer: la nueva vuelve a `generated`
        // para que 5.6 la reenvíe. La confirmación de la persona sí se hereda.
        const status: AccessKeyStatus =
          key.status === "sent" || key.status === "pending_confirmation" ? "generated" : key.status;
        const replacement: AccessKeyRow = {
          ...key,
          code: code!,
          status,
          regeneratedFrom: key.code,
          seats: key.seats - key.redeemedCount,
          redeemedCount: 0,
          // El código nuevo aún no ha salido por email.
          sentAt: null,
          usedAt: null,
          createdAt: now(),
        };
        const result = await store.rotateKey(
          key.code,
          { status: key.status, redeemedCount: key.redeemedCount },
          { status: "expired", seats: key.redeemedCount },
          replacement,
        );
        if (result.ok) return result.key;
        // CONFLICT (alguien canjeó o rotó a la vez) o colisión: se relee y reintenta.
      }
      throw new AccessKeyError("CONFLICT", "La clave cambió mientras se regeneraba; reinténtalo");
    },

    /**
     * Canje de un asiento, sin actor (lo usa `redeem` de 5.8, que añade la
     * asignación por `groupingMode` y el `joinToken`). Escritura condicional
     * sobre el estado leído: dos canjes simultáneos no consumen el mismo
     * asiento. La sesión/grupo propios de la clave mandan; si no tiene, se
     * fija la de `assign`. Con sesión, el store comprueba el aforo de forma
     * atómica (`SESSION_FULL`).
     *
     * `assign` puede ser una función: se reevalúa en cada intento con la clave
     * recién leída, así un reparto aleatorio que pierde la última plaza de una
     * sesión en carrera prueba en otra (o acaba en `SESSION_FULL`).
     */
    async consumeSeat(
      rawCode: string,
      assign:
        Partial<SeatAssignment> | ((key: AccessKeyRow) => Promise<Partial<SeatAssignment>>) = {},
    ): Promise<AccessKeyRow> {
      const code = normalizeAccessKeyCode(rawCode);
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
        const key = code ? await store.findKey(code) : null;
        if (!key) throw new AccessKeyError("ACCESS_KEY_INVALID", "Clave no válida");
        const check = checkRedeemable(key, now());
        if (!check.ok) throw new AccessKeyError(check.code, "La clave no se puede canjear");
        const assignment = typeof assign === "function" ? await assign(key) : assign;
        const sessionId = key.sessionId ?? assignment.sessionId ?? null;
        const groupId = key.groupId ?? assignment.groupId ?? null;
        const patch: AccessKeyPatch = {
          ...applyRedemption(key, now()),
          ...(key.sessionId === null && sessionId !== null ? { sessionId } : {}),
          ...(key.groupId === null && groupId !== null ? { groupId } : {}),
        };
        const expected = { status: key.status, redeemedCount: key.redeemedCount };
        if (sessionId === null) {
          const updated = await store.updateKey(key.code, expected, patch);
          if (updated) return updated;
          continue;
        }
        const result = await store.redeemSeat(key.code, expected, patch, sessionId);
        if (result.ok) return result.key;
        if (result.reason === "SESSION_FULL" && typeof assign !== "function") {
          throw new AccessKeyError("SESSION_FULL", "La sesión no admite más jugadores");
        }
        // CONFLICT, o sesión llena con reparto dinámico: se relee y reintenta.
      }
      throw new AccessKeyError("CONFLICT", "La clave cambió durante el canje; reinténtalo");
    },

    /** Pasada del job de caducidad con el reloj del servicio. */
    expireKeys(): Promise<ExpirySweepResult> {
      return expireAccessKeys(store, now());
    },
  };
}

export type AccessKeyService = ReturnType<typeof createAccessKeyService>;

// ── Implementación en memoria (tests y superficies sin base de datos) ──────

/**
 * Store en memoria con la misma semántica que el de Prisma. Lee los eventos del
 * `EventStore` que se le pase (así un test crea y activa eventos con el
 * servicio de 5.4 y genera claves sobre ellos).
 */
export function createInMemoryAccessKeyStore(opts: {
  events: Pick<EventStore, "findEvent">;
}): AccessKeyStore & {
  keys: AccessKeyRow[];
  sessions: GameSessionRef[];
  groups: Array<GroupRef & { name: string; completedAt: Date | null }>;
} {
  const keys: AccessKeyRow[] = [];
  const sessions: GameSessionRef[] = [];
  const groups: Array<GroupRef & { name: string; completedAt: Date | null }> = [];
  const copy = (k: AccessKeyRow): AccessKeyRow => structuredClone(k);
  const before = (a: AccessKeyListCursor, b: AccessKeyListCursor) =>
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  const committed = (eventId: string) =>
    keys.filter((k) => k.eventId === eventId).reduce((sum, k) => sum + k.seats, 0);
  const matches = (k: AccessKeyRow, e: AccessKeyExpectation) =>
    k.status === e.status && k.redeemedCount === e.redeemedCount;
  const apply = (k: AccessKeyRow, patch: AccessKeyPatch) => {
    for (const [field, value] of Object.entries(structuredClone(patch))) {
      if (value !== undefined) (k as Record<string, unknown>)[field] = value;
    }
  };
  const occupiedBy = (pred: (k: AccessKeyRow) => boolean) =>
    keys.filter(pred).reduce((sum, k) => sum + k.redeemedCount, 0);
  const hasRule = async (eventId: string, type: string) =>
    ((await opts.events.findEvent(eventId))?.expiryRules ?? []).some((r) => r.type === type);
  const expireWhere = async (pred: (k: AccessKeyRow) => boolean, rule: string) => {
    let n = 0;
    for (const k of keys) {
      if (isLiveAccessKey(k.status) && pred(k) && (await hasRule(k.eventId, rule))) {
        k.status = "expired";
        n++;
      }
    }
    return n;
  };

  return {
    keys,
    sessions,
    groups,
    findEvent: (id) => opts.events.findEvent(id),
    async listSessions(eventId) {
      return sessions.filter((s) => s.eventId === eventId).map((s) => ({ ...s }));
    },
    async insertSessions(eventId, rows) {
      const created = rows.map((r) => ({
        id: crypto.randomUUID(),
        eventId,
        name: r.name,
        capacity: r.capacity,
        status: "pending" as const,
      }));
      sessions.push(...created);
      return created.map((s) => ({ ...s }));
    },
    async findGroup(groupId) {
      const g = groups.find((x) => x.id === groupId);
      return g ? { id: g.id, sessionId: g.sessionId, eventId: g.eventId } : null;
    },
    async codesInUse(codes) {
      const all = new Set(keys.map((k) => k.code));
      return new Set(codes.filter((c) => all.has(c)));
    },
    async committedSeats(eventId) {
      return committed(eventId);
    },
    async insertKeys(eventId, seatLimit, rows) {
      const current = committed(eventId);
      if (current + rows.reduce((sum, r) => sum + r.seats, 0) > seatLimit) {
        return { ok: false, reason: "SEAT_LIMIT", committedSeats: current };
      }
      const existing = new Set(keys.map((k) => k.code));
      const batch = new Set<string>();
      for (const r of rows) {
        if (existing.has(r.code) || batch.has(r.code))
          return { ok: false, reason: "CODE_COLLISION" };
        batch.add(r.code);
      }
      keys.push(...rows.map(copy));
      return { ok: true, keys: rows.map(copy) };
    },
    async findKey(code) {
      const k = keys.find((x) => x.code === code);
      return k ? copy(k) : null;
    },
    async listKeys(eventId, { limit, after, status }) {
      return keys
        .filter((k) => k.eventId === eventId && (status === null || k.status === status))
        .filter((k) => after === null || before(after, k) < 0)
        .sort(before)
        .slice(0, limit)
        .map(copy);
    },
    async updateKey(code, expected, patch) {
      const k = keys.find((x) => x.code === code);
      if (!k || !matches(k, expected)) return null;
      apply(k, patch);
      return copy(k);
    },
    async rotateKey(code, expected, oldPatch, replacement) {
      const k = keys.find((x) => x.code === code);
      if (!k || !matches(k, expected)) return { ok: false, reason: "CONFLICT" };
      if (keys.some((x) => x.code === replacement.code)) {
        return { ok: false, reason: "CODE_COLLISION" };
      }
      apply(k, oldPatch);
      keys.push(copy(replacement));
      return { ok: true, key: copy(replacement) };
    },
    async listSessionSeats(eventId) {
      return sessions
        .filter((s) => s.eventId === eventId)
        .map((s) => ({ ...s, occupied: occupiedBy((k) => k.sessionId === s.id) }));
    },
    async listGroupSeats(sessionId) {
      return groups
        .filter((g) => g.sessionId === sessionId)
        .map((g) => ({
          id: g.id,
          sessionId: g.sessionId,
          name: g.name,
          occupied: occupiedBy((k) => k.groupId === g.id),
        }));
    },
    // Sin `await` entre lectura y escritura: atómico frente a otros canjes.
    async redeemSeat(code, expected, patch, sessionId) {
      const session = sessions.find((s) => s.id === sessionId);
      if (
        !session ||
        !OPEN_SESSION_STATUSES.includes(session.status) ||
        occupiedBy((k) => k.sessionId === sessionId) + 1 > session.capacity
      ) {
        return { ok: false, reason: "SESSION_FULL" };
      }
      const k = keys.find((x) => x.code === code);
      if (!k || !matches(k, expected)) return { ok: false, reason: "CONFLICT" };
      apply(k, patch);
      return { ok: true, key: copy(k) };
    },
    async expireByDeadline(now) {
      let n = 0;
      for (const k of keys) {
        if (isLiveAccessKey(k.status) && k.expiresAt && k.expiresAt.getTime() <= now.getTime()) {
          k.status = "expired";
          n++;
        }
      }
      return n;
    },
    async expireBySessionEnd() {
      const ended = new Set(sessions.filter((s) => s.status === "ended").map((s) => s.id));
      return expireWhere((k) => k.sessionId !== null && ended.has(k.sessionId), "on_session_end");
    },
    async expireByGroupComplete() {
      const done = new Set(groups.filter((g) => g.completedAt !== null).map((g) => g.id));
      return expireWhere((k) => k.groupId !== null && done.has(k.groupId), "on_group_complete");
    },
  };
}
