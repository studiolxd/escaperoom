import { z } from "zod";
import {
  AUDIO_KINDS,
  AUDIO_LIBRARY,
  findLibraryTrack,
  parseAudioRef,
  parseMp3,
  uploadAudioRef,
  type AudioKind,
  type AudioLibraryTrack,
} from "../audio";
import { toReadableIssues, type ReadableIssue } from "../schemas/errors";
import { isAnonymous, type Actor } from "./actor";

/**
 * Audio del creador (ticket 3.11, specs/15 §1 y §4, specs/17 §1): biblioteca
 * incluida + subida propia de MP3 con **moderación previa**. Una subida nace
 * `pending`; solo un moderador la aprueba (`approved`, usable al publicar) o la
 * rechaza con motivo (`rejected`, no usable en ningún sitio). Mientras está
 * pendiente su dueño puede colocarla en el borrador y escucharla, pero la sala
 * no se puede publicar con ella (specs/17 §1: excepción a la moderación
 * post-publicación).
 *
 * El proveedor de moderación automática (pre-filtro, specs/17 §3) va detrás de
 * `AudioModerationProvider`: aquí solo hay implementación manual/fake, nunca se
 * llama a un servicio externo.
 */

export type AudioAssetStatus = "pending" | "approved" | "rejected";

/** Fila persistida de `audioAsset` (migración 0011). */
export type AudioAssetRow = {
  id: string;
  ownerId: string;
  organizationId: string | null;
  storageKey: string;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  durationMs: number;
  status: AudioAssetStatus;
  /** Señales del pre-filtro automático (🟡 flag, specs/17 §3). */
  moderationFlags: string[];
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rightsDeclaredAt: Date;
  createdAt: Date;
};

export type NewAudioAsset = Omit<
  AudioAssetRow,
  "createdAt" | "status" | "rejectionReason" | "reviewedBy" | "reviewedAt"
>;

export type AudioReview = {
  status: Exclude<AudioAssetStatus, "pending">;
  rejectionReason: string | null;
  reviewedBy: string;
  reviewedAt: Date;
};

/** Puerto de persistencia de `audioAsset` (ADR-022). */
export interface AudioAssetStore {
  /** `user.isModerator || user.isAdmin`, consultado en cada llamada. */
  canModerate(userId: string): Promise<boolean>;
  insertAsset(asset: NewAudioAsset): Promise<AudioAssetRow>;
  findAsset(id: string): Promise<AudioAssetRow | null>;
  listByOwner(ownerId: string): Promise<AudioAssetRow[]>;
  listByStatus(status: AudioAssetStatus, limit: number): Promise<AudioAssetRow[]>;
  /**
   * Resuelve la revisión SOLO si la fila sigue `pending` (actualización
   * condicional); `null` si otro moderador se adelantó.
   */
  reviewIfPending(id: string, review: AudioReview): Promise<AudioAssetRow | null>;
}

/** Puerto de almacenamiento de binarios (el adaptador S3/R2 de `@escaperoom/kit/storage`). */
export interface AudioBlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** URL de lectura firmada y de vida corta (bucket privado). */
  signedReadUrl(key: string): Promise<string>;
}

/** Resultado del pre-filtro automático (specs/17 §3). */
export type AudioPrecheckResult =
  | { action: "allow"; flags?: string[] }
  | { action: "flag"; flags: string[] }
  | { action: "block"; reason: string };

/**
 * Pre-filtro automático de una subida (hash de contenido ilegal, voces de
 * terceros, copyright…). `block` rechaza la subida sin almacenarla; `flag` la
 * deja pendiente con señales para el moderador humano. Nunca aprueba: la
 * aprobación es siempre humana.
 */
export interface AudioModerationProvider {
  precheck(input: {
    ownerId: string;
    filename: string;
    bytes: Uint8Array;
    durationMs: number;
  }): Promise<AudioPrecheckResult>;
}

/** Pre-filtro manual: no marca nada; todo queda para la cola humana. */
export function createManualAudioModeration(): AudioModerationProvider {
  return {
    async precheck() {
      return { action: "allow" };
    },
  };
}

export type AudioErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "UPLOAD_BLOCKED"
  | "ALREADY_REVIEWED"
  | "AUDIO_PENDING_MODERATION"
  | "AUDIO_REJECTED";

/** Error de dominio del audio; los adaptadores lo traducen a HTTP/tRPC/MCP. */
export class AudioError extends Error {
  readonly code: AudioErrorCode;
  readonly issues: ReadableIssue[];
  /** Motivo del rechazo del moderador (`AUDIO_REJECTED`). */
  readonly rejectionReason: string | null;
  constructor(
    code: AudioErrorCode,
    message: string,
    extra: { issues?: ReadableIssue[]; rejectionReason?: string | null } = {},
  ) {
    super(message);
    this.name = "AudioError";
    this.code = code;
    this.issues = extra.issues ?? [];
    this.rejectionReason = extra.rejectionReason ?? null;
  }
}

/** Límites de subida (specs/15 §1). */
export type AudioUploadLimits = { maxBytes: number; maxDurationMs: number };

export const DEFAULT_AUDIO_UPLOAD_LIMITS: AudioUploadLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxDurationMs: 10 * 60 * 1000,
};

/** MIME que los navegadores declaran para un `.mp3` (el contenido se verifica aparte). */
export const MP3_DECLARED_MIME = ["audio/mpeg", "audio/mp3", "audio/mpeg3", "audio/x-mpeg-3"];
const STORED_MIME = "audio/mpeg";

export type AudioUploadInput = {
  filename: string;
  /** MIME declarado por el cliente (no es de fiar: se analiza el contenido). */
  contentType: string;
  bytes: Uint8Array;
  /** El creador declara tener los derechos (specs/15 §4, specs/18 §2). */
  rightsDeclared: boolean;
};

export const AudioReviewInput = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((r) => r.decision !== "rejected" || (r.reason?.length ?? 0) > 0, {
    message: "Un rechazo exige motivo (se muestra al creador)",
    path: ["reason"],
  });

export const AudioLibraryQuery = z.object({ kind: z.enum(AUDIO_KINDS).optional() });
export const AudioQueueQuery = z.object({
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Para qué se va a usar la referencia: el borrador tolera `pending`; publicar, no. */
export type AudioUsePurpose = "draft" | "publish";

export type ResolvedAudio =
  | { source: "library"; ref: string; track: AudioLibraryTrack; storageKey: string }
  | {
      source: "upload";
      ref: string;
      asset: AudioAssetRow;
      storageKey: string;
      status: AudioAssetStatus;
    };

export type AudioUsabilityProblem = {
  ref: string;
  code: AudioErrorCode;
  message: string;
  rejectionReason: string | null;
};

const MAX_FILENAME = 200;

function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AudioError("VALIDATION_ERROR", "Datos no válidos", {
      issues: toReadableIssues(parsed.error),
    });
  }
  return parsed.data;
}

function requireSession(actor: Actor): void {
  if (isAnonymous(actor)) throw new AudioError("UNAUTHORIZED", "No hay sesión");
}

function formatMb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Nombre de fichero legible y acotado (solo metadato; la clave del bucket es el id). */
function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // Sin caracteres de control (los nombres vienen del cliente).
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned || "audio.mp3").slice(0, MAX_FILENAME);
}

export function createAudioAssetService(deps: {
  store: AudioAssetStore;
  blobs: AudioBlobStore;
  moderation?: AudioModerationProvider;
  limits?: Partial<AudioUploadLimits>;
  now?: () => Date;
  newId?: () => string;
}) {
  const { store, blobs } = deps;
  const moderation = deps.moderation ?? createManualAudioModeration();
  const limits = { ...DEFAULT_AUDIO_UPLOAD_LIMITS, ...deps.limits };
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());

  async function requireModerator(actor: Actor): Promise<void> {
    requireSession(actor);
    if (!(await store.canModerate(actor.userId))) {
      throw new AudioError("FORBIDDEN", "Solo moderadores o administradores");
    }
  }

  /** La subida existe y es del actor (o el actor modera). */
  async function requireReadable(actor: Actor, id: string): Promise<AudioAssetRow> {
    requireSession(actor);
    const asset = z.uuid().safeParse(id).success ? await store.findAsset(id) : null;
    if (!asset) throw new AudioError("NOT_FOUND", "Audio no encontrado");
    if (asset.ownerId !== actor.userId && !(await store.canModerate(actor.userId))) {
      // Mismo error que "no existe": no se revela qué ids tienen otros usuarios.
      throw new AudioError("NOT_FOUND", "Audio no encontrado");
    }
    return asset;
  }

  function validateUpload(input: AudioUploadInput): { durationMs: number } {
    if (input.rightsDeclared !== true) {
      throw new AudioError("VALIDATION_ERROR", "Debes declarar que tienes los derechos del audio", {
        issues: [{ path: "rightsDeclared", message: "Obligatorio" }],
      });
    }
    if (input.bytes.byteLength === 0) {
      throw new AudioError("VALIDATION_ERROR", "El fichero está vacío", {
        issues: [{ path: "file", message: "Vacío" }],
      });
    }
    if (input.bytes.byteLength > limits.maxBytes) {
      throw new AudioError(
        "PAYLOAD_TOO_LARGE",
        `El fichero ocupa ${formatMb(input.bytes.byteLength)}; el máximo es ${formatMb(limits.maxBytes)}`,
      );
    }
    const declared = input.contentType.split(";")[0]!.trim().toLowerCase();
    const declaredOk =
      MP3_DECLARED_MIME.includes(declared) ||
      // Algunos navegadores no infieren el tipo: se decide por el contenido.
      ((declared === "" || declared === "application/octet-stream") &&
        /\.mp3$/i.test(input.filename));
    const info = declaredOk ? parseMp3(input.bytes) : null;
    if (!info) {
      throw new AudioError(
        "UNSUPPORTED_MEDIA_TYPE",
        "Solo se aceptan ficheros MP3 (el contenido no es un MP3 válido)",
      );
    }
    if (info.durationMs > limits.maxDurationMs) {
      throw new AudioError(
        "VALIDATION_ERROR",
        `El audio dura ${formatDuration(info.durationMs)}; el máximo es ${formatDuration(limits.maxDurationMs)}`,
        { issues: [{ path: "file", message: "Demasiado largo" }] },
      );
    }
    return { durationMs: info.durationMs };
  }

  /** Resuelve una referencia para `purpose`, o lanza el motivo por el que no es usable. */
  async function resolveRef(
    actor: Actor,
    value: string,
    purpose: AudioUsePurpose,
  ): Promise<ResolvedAudio> {
    const ref = parseAudioRef(value);
    if (!ref) throw new AudioError("VALIDATION_ERROR", `Referencia de audio no válida: "${value}"`);
    if (ref.source === "library") {
      const track = findLibraryTrack(ref.trackId);
      if (!track) throw new AudioError("NOT_FOUND", `La biblioteca no tiene "${ref.trackId}"`);
      return { source: "library", ref: value, track, storageKey: track.storageKey };
    }
    requireSession(actor);
    const asset = await store.findAsset(ref.assetId);
    if (!asset) throw new AudioError("NOT_FOUND", "Audio no encontrado");
    if (asset.ownerId !== actor.userId) {
      throw new AudioError("FORBIDDEN", "No puedes usar un audio subido por otro usuario");
    }
    if (asset.status === "rejected") {
      throw new AudioError(
        "AUDIO_REJECTED",
        `El audio "${asset.originalFilename}" fue rechazado en moderación: ${asset.rejectionReason ?? "sin motivo"}`,
        { rejectionReason: asset.rejectionReason },
      );
    }
    if (asset.status === "pending" && purpose === "publish") {
      throw new AudioError(
        "AUDIO_PENDING_MODERATION",
        `El audio "${asset.originalFilename}" está pendiente de moderación; no se puede publicar hasta que se apruebe`,
      );
    }
    return {
      source: "upload",
      ref: value,
      asset,
      storageKey: asset.storageKey,
      status: asset.status,
    };
  }

  return {
    limits,

    /** Catálogo de la biblioteca incluida, filtrable por tipo. Público. */
    listLibrary(query: unknown = {}): AudioLibraryTrack[] {
      const { kind } = parseOrThrow(AudioLibraryQuery, query);
      return AUDIO_LIBRARY.filter((t) => kind === undefined || t.kind === (kind as AudioKind));
    },

    /** Solo el guard de sesión (los adaptadores lo usan antes de leer el cuerpo). */
    authorizeUpload(actor: Actor): void {
      requireSession(actor);
    },

    /**
     * Sube un MP3 propio: valida tipo real, tamaño y duración, pasa el
     * pre-filtro automático y queda `pending` hasta la revisión humana.
     */
    async uploadAudio(actor: Actor, input: AudioUploadInput): Promise<AudioAssetRow> {
      requireSession(actor);
      const { durationMs } = validateUpload(input);
      const filename = cleanFilename(input.filename);
      const verdict = await moderation.precheck({
        ownerId: actor.userId,
        filename,
        bytes: input.bytes,
        durationMs,
      });
      if (verdict.action === "block") {
        // 🛑 No se almacena nada (specs/17 §3).
        throw new AudioError("UPLOAD_BLOCKED", `Subida bloqueada: ${verdict.reason}`);
      }

      const id = newId();
      const storageKey = `uploads/audio/${actor.userId}/${id}.mp3`;
      await blobs.put(storageKey, input.bytes, STORED_MIME);
      try {
        return await store.insertAsset({
          id,
          ownerId: actor.userId,
          organizationId: actor.organizationId,
          storageKey,
          originalFilename: filename,
          contentType: STORED_MIME,
          byteSize: input.bytes.byteLength,
          durationMs,
          moderationFlags: verdict.flags ?? [],
          rightsDeclaredAt: now(),
        });
      } catch (err) {
        // Sin fila no hay forma de llegar al objeto: se limpia (mejor esfuerzo).
        await blobs.delete(storageKey).catch(() => undefined);
        throw err;
      }
    },

    /** Subidas propias del actor (todas, con su estado y motivo de rechazo). */
    async listMyUploads(actor: Actor): Promise<AudioAssetRow[]> {
      requireSession(actor);
      const rows = await store.listByOwner(actor.userId);
      return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    /** Metadatos + URL de escucha firmada (dueño o moderador). */
    async getUpload(
      actor: Actor,
      id: string,
    ): Promise<{ asset: AudioAssetRow; previewUrl: string | null }> {
      const asset = await requireReadable(actor, id);
      // Un audio rechazado ya no se sirve (ni siquiera a su dueño).
      const previewUrl =
        asset.status === "rejected" ? null : await blobs.signedReadUrl(asset.storageKey);
      return { asset, previewUrl };
    },

    /** Cola de moderación (`pending` por defecto, las más antiguas primero). */
    async listModerationQueue(actor: Actor, query: unknown = {}): Promise<AudioAssetRow[]> {
      await requireModerator(actor);
      const { status, limit } = parseOrThrow(AudioQueueQuery, query);
      const rows = await store.listByStatus(status, limit);
      return [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },

    authorizeModeration(actor: Actor): Promise<void> {
      return requireModerator(actor);
    },

    /** Revisión humana: `approved` (usable) o `rejected` con motivo (no usable). */
    async reviewUpload(actor: Actor, id: string, input: unknown): Promise<AudioAssetRow> {
      await requireModerator(actor);
      const { decision, reason } = parseOrThrow(AudioReviewInput, input);
      const asset = z.uuid().safeParse(id).success ? await store.findAsset(id) : null;
      if (!asset) throw new AudioError("NOT_FOUND", "Audio no encontrado");
      const reviewed = await store.reviewIfPending(id, {
        status: decision,
        rejectionReason: decision === "rejected" ? (reason ?? null) : null,
        reviewedBy: actor.userId,
        reviewedAt: now(),
      });
      if (!reviewed) {
        throw new AudioError("ALREADY_REVIEWED", "Este audio ya se revisó");
      }
      return reviewed;
    },

    /**
     * Comprueba que el actor puede usar una referencia (`library:`/`upload:`)
     * para `purpose`. Lanza `FORBIDDEN` (audio de otro usuario),
     * `AUDIO_REJECTED` (con motivo) o, al publicar, `AUDIO_PENDING_MODERATION`.
     */
    resolveAudioRef: resolveRef,

    /**
     * Revisa todas las referencias de audio de un borrador de cara a publicar
     * (lo invocará la publicación, 3.9). No lanza: devuelve los problemas.
     */
    async checkRefsForPublish(
      actor: Actor,
      refs: readonly string[],
    ): Promise<AudioUsabilityProblem[]> {
      const problems: AudioUsabilityProblem[] = [];
      for (const ref of new Set(refs)) {
        try {
          await resolveRef(actor, ref, "publish");
        } catch (err) {
          if (!(err instanceof AudioError)) throw err;
          problems.push({
            ref,
            code: err.code,
            message: err.message,
            rejectionReason: err.rejectionReason,
          });
        }
      }
      return problems;
    },
  };
}

export type AudioAssetService = ReturnType<typeof createAudioAssetService>;

/** Referencia de borrador para una fila subida. */
export const audioAssetRef = (asset: Pick<AudioAssetRow, "id">): string => uploadAudioRef(asset.id);

/** Store en memoria (tests y superficies sin base de datos). */
export function createInMemoryAudioAssetStore(
  opts: { moderatorIds?: Iterable<string>; now?: () => Date } = {},
): AudioAssetStore & { rows: Map<string, AudioAssetRow> } {
  const moderators = new Set(opts.moderatorIds ?? []);
  const now = opts.now ?? (() => new Date());
  const rows = new Map<string, AudioAssetRow>();
  return {
    rows,
    async canModerate(userId) {
      return moderators.has(userId);
    },
    async insertAsset(asset) {
      const row: AudioAssetRow = {
        ...asset,
        status: "pending",
        rejectionReason: null,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: now(),
      };
      rows.set(row.id, row);
      return { ...row };
    },
    async findAsset(id) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async listByOwner(ownerId) {
      return [...rows.values()].filter((r) => r.ownerId === ownerId).map((r) => ({ ...r }));
    },
    async listByStatus(status, limit) {
      return [...rows.values()]
        .filter((r) => r.status === status)
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
    async reviewIfPending(id, review) {
      const row = rows.get(id);
      if (!row || row.status !== "pending") return null;
      const next = { ...row, ...review };
      rows.set(id, next);
      return { ...next };
    },
  };
}

/** Almacén de binarios en memoria (tests). */
export function createInMemoryAudioBlobStore(): AudioBlobStore & {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
} {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    async put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType });
    },
    async delete(key) {
      objects.delete(key);
    },
    async signedReadUrl(key) {
      if (!objects.has(key)) throw new Error(`No existe ${key}`);
      return `memory://${key}`;
    },
  };
}
