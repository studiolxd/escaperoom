import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { toReadableIssues, type ReadableIssue } from "../schemas/errors";
import { isAnonymous, type Actor } from "./actor";
import { isLiveAccessKey, normalizeAccessKeyCode, type AccessKeyRow } from "./access-keys";
import {
  CARD_LOCALES,
  isCardLocale,
  renderAccessKeyCardsPdf,
  type CardLocale,
  type CardPdfInput,
} from "./access-key-cards-pdf";
import type { EventRow, EventStore } from "./events";

/**
 * PDF de tarjetas-clave de un evento (ticket 5.7, specs/13 §9).
 *
 * - **Qué se imprime**: sin `codes`, todas las claves vivas del evento (las
 *   canjeadas o caducadas no sirven en papel); con `codes`, exactamente esas en
 *   ese orden, sea cual sea su estado (reimprimir es decisión del organizador),
 *   siempre que sean del evento.
 * - **Síncrono o asíncrono**: menos de `SYNC_EXPORT_LIMIT` tarjetas se devuelven
 *   como PDF en la misma respuesta; a partir de ahí se encola un job que el
 *   worker (`@escaperoom/worker`) renderiza y sube al almacenamiento, y el estado
 *   se consulta con `getExport`.
 * - **Descarga**: la URL del PDF del job la firma la app (HMAC-SHA256 sobre
 *   `jobId` + caducidad, clave derivada de `APP_SECRET`) y caduca 24 h después
 *   de terminar el job. Es un enlace portador: no pide sesión, sí firma válida.
 * - **Idioma**: el del evento, que es el idioma por defecto de la versión de sala
 *   (`meta.defaultLanguage`), salvo que la petición pida otro de los 6 locales.
 * - Solo el organizador del evento exporta y consulta sus exports.
 */

// ── Constantes ─────────────────────────────────────────────────────────────

/** Por debajo de este número de tarjetas el PDF sale en la propia respuesta. */
export const SYNC_EXPORT_LIMIT = 50;
/** Tope de tarjetas por export (memoria del worker y tamaño del PDF). */
export const MAX_CARDS_PER_EXPORT = 5000;
/** Vida de la URL de descarga desde que termina el job. */
export const EXPORT_DOWNLOAD_TTL_MS = 24 * 60 * 60 * 1000;
/** Ruta pública de canje a la que apunta el QR (`/{locale}/redeem?code=`). */
export const REDEEM_PAGE_PATH = "redeem";

// ── Errores ────────────────────────────────────────────────────────────────

export type AccessKeyCardsErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "NO_PRINTABLE_KEYS"
  | "EXPORT_UNAVAILABLE"
  | "EXPORT_LINK_INVALID"
  | "EXPORT_LINK_EXPIRED";

/** Error de dominio del export; los adaptadores lo traducen a HTTP. */
export class AccessKeyCardsError extends Error {
  readonly code: AccessKeyCardsErrorCode;
  readonly issues: ReadableIssue[];
  constructor(code: AccessKeyCardsErrorCode, message: string, issues: ReadableIssue[] = []) {
    super(message);
    this.name = "AccessKeyCardsError";
    this.code = code;
    this.issues = issues;
  }
}

// ── Entrada ────────────────────────────────────────────────────────────────

export const ExportCardsInput = z
  .object({
    codes: z.array(z.string().max(32)).min(1).max(MAX_CARDS_PER_EXPORT).optional(),
    locale: z.enum(CARD_LOCALES).optional(),
  })
  .strict();

function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AccessKeyCardsError(
      "VALIDATION_ERROR",
      "Datos no válidos",
      toReadableIssues(parsed.error),
    );
  }
  return parsed.data;
}

// ── Puertos ────────────────────────────────────────────────────────────────

/** Lo que la tarjeta necesita de la versión de sala del evento (`package.meta`). */
export type CardRoomMeta = { title: string; languages: string[]; defaultLanguage: string };

/** Puerto de lectura del export (ADR-022). */
export interface AccessKeyCardStore {
  findEvent(eventId: string): Promise<EventRow | null>;
  findRoomMeta(roomVersionId: string): Promise<CardRoomMeta | null>;
  /**
   * Claves del evento en orden `createdAt, code`. Con `codes`, solo esas (las
   * que no sean del evento no vuelven); con `liveOnly`, solo las vivas.
   */
  listEventKeys(
    eventId: string,
    opts: { codes: string[] | null; liveOnly: boolean; limit: number },
  ): Promise<AccessKeyRow[]>;
}

/** Datos del job asíncrono (serializables: viajan por Redis). */
export type CardExportJobData = {
  eventId: string;
  /** Quien lo pidió: el worker revalida que siga siendo el organizador. */
  organizerId: string;
  codes: string[];
  locale: CardLocale;
  /** Origen público de la app, para las URLs de canje del QR. */
  appUrl: string;
};

export type CardExportResult = { storageKey: string; cards: number };

export type CardExportJobStatus = "queued" | "processing" | "completed" | "failed";

export type CardExportJob = {
  id: string;
  status: CardExportJobStatus;
  data: CardExportJobData;
  result: CardExportResult | null;
  finishedAt: Date | null;
};

/** Cola del export (BullMQ en producción, en memoria en tests). */
export interface CardExportQueue {
  /** `false` si la cola está deshabilitada o no se pudo encolar. */
  enqueue(jobId: string, data: CardExportJobData): Promise<boolean>;
  find(jobId: string): Promise<CardExportJob | null>;
}

/** Destino del PDF del job (bucket privado vía `@escaperoom/kit/storage`). */
export type CardExportBlobStore = {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
};

// ── Firma de la URL de descarga ────────────────────────────────────────────

/** Secreto de desarrollo: solo fuera de `NODE_ENV=production`. */
export const DEV_EXPORT_SIGNING_SECRET = "dev-export-signing-secret-no-usar-en-produccion";

/** Secreto de firma de descargas; `null` (export asíncrono desactivado) sin `APP_SECRET` en producción. */
export function readExportSigningSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const configured = env.APP_SECRET?.trim();
  return configured || (env.NODE_ENV === "production" ? null : DEV_EXPORT_SIGNING_SECRET);
}

/** Clave derivada: separación de dominio respecto a otros usos de `APP_SECRET`. */
function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("escaperoom/export-download/v1").digest();
}

/** Firma `jobId` + caducidad (segundos desde epoch). */
export function signExportDownload(secret: string, jobId: string, expiresSec: number): string {
  return createHmac("sha256", signingKey(secret))
    .update(`${jobId}.${expiresSec}`)
    .digest("base64url");
}

export type ExportDownloadCheck =
  { ok: true } | { ok: false; error: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" };

/** Verifica firma (tiempo constante) y caducidad; `now` en ms. */
export function verifyExportDownload(
  secret: string,
  jobId: string,
  expires: string | null,
  signature: string | null,
  now: number = Date.now(),
): ExportDownloadCheck {
  if (!expires || !signature || !/^\d{1,12}$/.test(expires) || signature.length > 128) {
    return { ok: false, error: "MALFORMED" };
  }
  const expiresSec = Number(expires);
  const expected = Buffer.from(signExportDownload(secret, jobId, expiresSec));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, error: "BAD_SIGNATURE" };
  }
  if (expiresSec * 1000 <= now) return { ok: false, error: "EXPIRED" };
  return { ok: true };
}

/** Clave del objeto con el PDF de un job. */
export function exportStorageKey(jobId: string): string {
  return `exports/access-key-cards/${jobId}.pdf`;
}

/** URL de descarga firmada (relativa a `appUrl`). */
export function buildExportDownloadUrl(
  appUrl: string,
  secret: string,
  jobId: string,
  expiresAt: Date,
): string {
  const expiresSec = Math.floor(expiresAt.getTime() / 1000);
  const url = new URL(`/api/exports/${encodeURIComponent(jobId)}/download`, appUrl);
  url.searchParams.set("expires", String(expiresSec));
  url.searchParams.set("signature", signExportDownload(secret, jobId, expiresSec));
  return url.toString();
}

// ── Servicio ───────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hoja de tarjetas ya resuelta: evento, idioma y claves en orden. */
export type CardSheet = {
  eventId: string;
  eventTitle: string;
  roomTitle: string;
  locale: CardLocale;
  keys: Array<Pick<AccessKeyRow, "code" | "seats" | "expiresAt">>;
};

export type ExportCardsResult =
  | { kind: "pdf"; bytes: Uint8Array; cards: number; filename: string }
  | { kind: "job"; jobId: string; cards: number };

/** Estado público de un export asíncrono (`GET /api/exports/:jobId`). */
export type ExportStatusView = {
  jobId: string;
  eventId: string;
  status: CardExportJobStatus | "expired";
  cards: number;
  downloadUrl: string | null;
  expiresAt: Date | null;
};

/** Idioma del evento: el pedido, o el por defecto de la sala si es de los 6, o el primero que lo sea. */
export function resolveCardLocale(room: CardRoomMeta, requested?: CardLocale): CardLocale {
  if (requested) return requested;
  if (isCardLocale(room.defaultLanguage)) return room.defaultLanguage;
  return room.languages.find(isCardLocale) ?? "es";
}

/** URL de canje con la clave (QR) y la de la página sin ella (texto impreso). */
export function redeemUrls(appUrl: string, locale: CardLocale) {
  const page = new URL(`/${locale}/${REDEEM_PAGE_PATH}`, appUrl);
  return {
    forCode: (code: string) => {
      const url = new URL(page);
      url.searchParams.set("code", code);
      return url.toString();
    },
    /** Sin protocolo: es lo que alguien teclea a partir del papel. */
    printable: `${page.host}${page.pathname}`,
  };
}

export function createAccessKeyCardsService(deps: {
  store: AccessKeyCardStore;
  /** `null`: sin cola, solo el export síncrono. */
  queue: CardExportQueue | null;
  /** Secreto de las URLs de descarga; `null` desactiva el export asíncrono. */
  signingSecret: string | null;
  render?: (input: CardPdfInput) => Promise<Uint8Array>;
  now?: () => Date;
  newJobId?: () => string;
}) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const render = deps.render ?? renderAccessKeyCardsPdf;
  const newJobId = deps.newJobId ?? randomUUID;

  function requireUser(actor: Actor): void {
    if (isAnonymous(actor)) throw new AccessKeyCardsError("UNAUTHORIZED", "No hay sesión");
  }

  async function findOwnEvent(actor: Actor, eventId: string): Promise<EventRow> {
    requireUser(actor);
    const event = UUID_RE.test(eventId) ? await store.findEvent(eventId) : null;
    if (!event) throw new AccessKeyCardsError("NOT_FOUND", "Evento no encontrado");
    if (event.organizerId !== actor.userId) {
      throw new AccessKeyCardsError(
        "FORBIDDEN",
        "Solo el organizador exporta las tarjetas del evento",
      );
    }
    return event;
  }

  /** Normaliza y deduplica los códigos pedidos, conservando el orden. */
  function normalizeCodes(raw: string[]): string[] {
    const issues: ReadableIssue[] = [];
    const codes: string[] = [];
    raw.forEach((value, i) => {
      const code = normalizeAccessKeyCode(value);
      if (!code) issues.push({ path: `codes.${i}`, message: "Clave con formato no válido" });
      else if (!codes.includes(code)) codes.push(code);
    });
    if (issues.length > 0) {
      throw new AccessKeyCardsError("VALIDATION_ERROR", "Datos no válidos", issues);
    }
    return codes;
  }

  async function prepareSheet(actor: Actor, eventId: string, input: unknown): Promise<CardSheet> {
    const event = await findOwnEvent(actor, eventId);
    const data = parseOrThrow(ExportCardsInput, input ?? {});
    const room = await store.findRoomMeta(event.roomVersionId);
    if (!room) throw new AccessKeyCardsError("NOT_FOUND", "Versión de sala no encontrada");

    const codes = data.codes ? normalizeCodes(data.codes) : null;
    const rows = await store.listEventKeys(event.id, {
      codes,
      liveOnly: codes === null,
      limit: MAX_CARDS_PER_EXPORT + 1,
    });
    let keys = rows;
    if (codes) {
      const byCode = new Map(rows.map((k) => [k.code, k]));
      const missing = codes.filter((c) => !byCode.has(c));
      if (missing.length > 0) {
        throw new AccessKeyCardsError(
          "VALIDATION_ERROR",
          "Hay claves que no son de este evento",
          missing.map((code) => ({ path: `codes.${codes.indexOf(code)}`, message: code })),
        );
      }
      keys = codes.map((c) => byCode.get(c)!);
    } else if (keys.length > MAX_CARDS_PER_EXPORT) {
      throw new AccessKeyCardsError(
        "VALIDATION_ERROR",
        `Como mucho ${MAX_CARDS_PER_EXPORT} tarjetas por export: indica las claves con \`codes\``,
      );
    }
    if (keys.length === 0) {
      throw new AccessKeyCardsError("NO_PRINTABLE_KEYS", "El evento no tiene claves que imprimir");
    }
    return {
      eventId: event.id,
      eventTitle: event.title,
      roomTitle: room.title,
      locale: resolveCardLocale(room, data.locale),
      keys: keys.map((k) => ({ code: k.code, seats: k.seats, expiresAt: k.expiresAt })),
    };
  }

  async function renderSheet(sheet: CardSheet, appUrl: string): Promise<Uint8Array> {
    const urls = redeemUrls(appUrl, sheet.locale);
    return render({
      eventTitle: sheet.eventTitle,
      roomTitle: sheet.roomTitle,
      locale: sheet.locale,
      redeemPageUrl: urls.printable,
      createdAt: now(),
      cards: sheet.keys.map((k) => ({
        code: k.code,
        redeemUrl: urls.forCode(k.code),
        seats: k.seats,
        expiresAt: k.expiresAt,
      })),
    });
  }

  function downloadDeadline(job: CardExportJob): Date | null {
    return job.finishedAt ? new Date(job.finishedAt.getTime() + EXPORT_DOWNLOAD_TTL_MS) : null;
  }

  return {
    /** Solo el guard de sesión (los adaptadores lo usan antes de leer el cuerpo). */
    authorize(actor: Actor): void {
      requireUser(actor);
    },

    prepareSheet,
    renderSheet,

    /**
     * `POST /api/events/:id/access-keys/export-pdf` — `{ codes?, locale? }`.
     * < `SYNC_EXPORT_LIMIT` tarjetas: el PDF; si no, encola el job.
     */
    async exportCards(
      actor: Actor,
      eventId: string,
      input: unknown,
      opts: { appUrl: string },
    ): Promise<ExportCardsResult> {
      const sheet = await prepareSheet(actor, eventId, input);
      const cards = sheet.keys.length;
      if (cards < SYNC_EXPORT_LIMIT) {
        return {
          kind: "pdf",
          bytes: await renderSheet(sheet, opts.appUrl),
          cards,
          filename: `tarjetas-${sheet.eventId.slice(0, 8)}.pdf`,
        };
      }
      if (!deps.queue || !deps.signingSecret) {
        throw new AccessKeyCardsError(
          "EXPORT_UNAVAILABLE",
          `El export de ${SYNC_EXPORT_LIMIT} tarjetas o más necesita la cola de trabajos`,
        );
      }
      const jobId = newJobId();
      const queued = await deps.queue.enqueue(jobId, {
        eventId: sheet.eventId,
        organizerId: actor.userId,
        codes: sheet.keys.map((k) => k.code),
        locale: sheet.locale,
        appUrl: opts.appUrl,
      });
      if (!queued) {
        throw new AccessKeyCardsError("EXPORT_UNAVAILABLE", "No se pudo encolar el export");
      }
      return { kind: "job", jobId, cards };
    },

    /** `GET /api/exports/:jobId` — estado y, si terminó, la URL firmada (24 h). */
    async getExport(
      actor: Actor,
      jobId: string,
      opts: { appUrl: string },
    ): Promise<ExportStatusView> {
      requireUser(actor);
      const job = UUID_RE.test(jobId) && deps.queue ? await deps.queue.find(jobId) : null;
      if (!job) throw new AccessKeyCardsError("NOT_FOUND", "Export no encontrado");
      if (job.data.organizerId !== actor.userId) {
        throw new AccessKeyCardsError("FORBIDDEN", "Solo el organizador consulta sus exports");
      }
      const view: ExportStatusView = {
        jobId: job.id,
        eventId: job.data.eventId,
        status: job.status,
        cards: job.data.codes.length,
        downloadUrl: null,
        expiresAt: null,
      };
      const deadline = downloadDeadline(job);
      if (job.status !== "completed" || !job.result || !deadline || !deps.signingSecret) {
        return view;
      }
      if (deadline.getTime() <= now().getTime()) return { ...view, status: "expired" };
      return {
        ...view,
        downloadUrl: buildExportDownloadUrl(opts.appUrl, deps.signingSecret, job.id, deadline),
        expiresAt: deadline,
      };
    },

    /**
     * `GET /api/exports/:jobId/download?expires&signature` — valida la firma y
     * devuelve la clave del objeto. No pide sesión: el enlace es el permiso.
     */
    verifyDownload(jobId: string, expires: string | null, signature: string | null): string {
      if (!deps.signingSecret || !UUID_RE.test(jobId)) {
        throw new AccessKeyCardsError("EXPORT_LINK_INVALID", "Enlace de descarga no válido");
      }
      const check = verifyExportDownload(
        deps.signingSecret,
        jobId,
        expires,
        signature,
        now().getTime(),
      );
      if (!check.ok) {
        throw check.error === "EXPIRED"
          ? new AccessKeyCardsError("EXPORT_LINK_EXPIRED", "El enlace de descarga ha caducado")
          : new AccessKeyCardsError("EXPORT_LINK_INVALID", "Enlace de descarga no válido");
      }
      return exportStorageKey(jobId);
    },

    /**
     * Trabajo del worker: revalida al organizador, renderiza y sube el PDF. Es
     * idempotente (misma clave de objeto por job), así que reintentar es inocuo.
     */
    async runExportJob(
      jobId: string,
      data: CardExportJobData,
      blobs: Pick<CardExportBlobStore, "put">,
    ): Promise<CardExportResult> {
      const actor: Actor = { userId: data.organizerId, organizationId: null, role: "member" };
      const sheet = await prepareSheet(actor, data.eventId, {
        codes: data.codes,
        locale: data.locale,
      });
      const bytes = await renderSheet(sheet, data.appUrl);
      const storageKey = exportStorageKey(jobId);
      await blobs.put(storageKey, bytes, "application/pdf");
      return { storageKey, cards: sheet.keys.length };
    },
  };
}

export type AccessKeyCardsService = ReturnType<typeof createAccessKeyCardsService>;

// ── Implementaciones en memoria (tests) ────────────────────────────────────

/** Store en memoria sobre las claves de `createInMemoryAccessKeyStore`. */
export function createInMemoryAccessKeyCardStore(opts: {
  events: Pick<EventStore, "findEvent">;
  keys: { keys: AccessKeyRow[] };
  rooms: Record<string, CardRoomMeta>;
}): AccessKeyCardStore {
  return {
    findEvent: (id) => opts.events.findEvent(id),
    async findRoomMeta(roomVersionId) {
      const room = opts.rooms[roomVersionId];
      return room ? structuredClone(room) : null;
    },
    async listEventKeys(eventId, { codes, liveOnly, limit }) {
      return opts.keys.keys
        .filter(
          (k) =>
            k.eventId === eventId &&
            (codes === null || codes.includes(k.code)) &&
            (!liveOnly || isLiveAccessKey(k.status)),
        )
        .sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
        )
        .slice(0, limit)
        .map((k) => structuredClone(k));
    },
  };
}

/** Cola en memoria: `runPending` hace de worker (mismo `runExportJob`). */
export function createInMemoryCardExportQueue(opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date());
  const jobs = new Map<string, CardExportJob>();
  const queue: CardExportQueue & {
    jobs: Map<string, CardExportJob>;
    runPending(
      processor: (jobId: string, data: CardExportJobData) => Promise<CardExportResult>,
    ): Promise<void>;
  } = {
    jobs,
    async enqueue(jobId, data) {
      jobs.set(jobId, {
        id: jobId,
        status: "queued",
        data: structuredClone(data),
        result: null,
        finishedAt: null,
      });
      return true;
    },
    async find(jobId) {
      const job = jobs.get(jobId);
      return job ? structuredClone(job) : null;
    },
    async runPending(processor) {
      for (const job of jobs.values()) {
        if (job.status !== "queued") continue;
        job.status = "processing";
        try {
          job.result = await processor(job.id, job.data);
          job.status = "completed";
        } catch {
          job.status = "failed";
        }
        job.finishedAt = now();
      }
    },
  };
  return queue;
}

/** Almacén de objetos en memoria (el bucket de los tests). */
export function createInMemoryBlobStore(): CardExportBlobStore & {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
} {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    async put(key, bytes, contentType) {
      objects.set(key, { bytes: new Uint8Array(bytes), contentType });
    },
    async get(key) {
      return objects.get(key)?.bytes ?? null;
    },
  };
}
