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
import { type Actor } from "./actor";
import { requireUser } from "./common";

/**
 * Audio del creador (ticket 3.11, specs/15 §1, specs/17 §1): biblioteca
 * incluida + subida propia de MP3. Desde la decisión de 2026-09-26 (ADR-039)
 * un audio nuevo (subido o generado con IA) queda `approved` y disponible al
 * instante, sin cola de revisión previa: el creador es responsable de su
 * contenido y el organizador de un evento decide si es adecuado para su
 * grupo (Términos de Servicio §3 y §6). El control es posterior, por
 * reportes (specs/17), igual que el resto del contenido de una sala.
 *
 * `rejected` solo existe como estado histórico de decisiones humanas ya
 * tomadas antes de ese cambio (audios rechazados por la extinta cola de
 * moderación): se conservan inutilizables, no se liberan.
 */

export type AudioAssetStatus = "approved" | "rejected";

/** De dónde viene el fichero (ticket 4.9, migración 0017): subida propia o generación IA. */
export type AudioAssetSource = "upload" | "ai_generated";

/** Fila persistida de `audioAsset` (migraciones 0011 y 0017). */
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
  /** Motivo del rechazo humano (solo histórico: ya no hay cola que lo produzca). */
  rejectionReason: string | null;
  rightsDeclaredAt: Date;
  createdAt: Date;
  source: AudioAssetSource;
  /** Solo `ai_generated`: el texto sintetizado y la voz usada. */
  generationText: string | null;
  generationVoiceId: string | null;
  /** Solo `ai_generated`: créditos cobrados por esta generación (ya descontados al confirmar). */
  generationCreditsCost: number | null;
};

export type NewAudioAsset = Omit<
  AudioAssetRow,
  | "createdAt"
  | "status"
  | "rejectionReason"
  | "source"
  | "generationText"
  | "generationVoiceId"
  | "generationCreditsCost"
> & {
  /** Por defecto `"upload"` (los llamantes existentes no la pasan). */
  source?: AudioAssetSource;
  generationText?: string | null;
  generationVoiceId?: string | null;
  generationCreditsCost?: number | null;
};

/** Puerto de persistencia de `audioAsset` (ADR-022). */
export interface AudioAssetStore {
  insertAsset(asset: NewAudioAsset): Promise<AudioAssetRow>;
  findAsset(id: string): Promise<AudioAssetRow | null>;
  listByOwner(ownerId: string): Promise<AudioAssetRow[]>;
  /** Deshace un alta (ticket 4.9: la generación se cobra después de insertar; si el cobro falla, no debe quedar disponible). */
  deleteAsset(id: string): Promise<void>;
}

/** Puerto de almacenamiento de binarios (el adaptador S3/R2 de `@escaperoom/kit/storage`). */
export interface AudioBlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** URL de lectura firmada y de vida corta (bucket privado). */
  signedReadUrl(key: string): Promise<string>;
}

export type AudioErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "AUDIO_REJECTED";

/** Error de dominio del audio; los adaptadores lo traducen a HTTP/tRPC/MCP. */
export class AudioError extends Error {
  readonly code: AudioErrorCode;
  readonly issues: ReadableIssue[];
  /** Motivo del rechazo histórico (`AUDIO_REJECTED`). */
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

export const AudioLibraryQuery = z.object({ kind: z.enum(AUDIO_KINDS).optional() });

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
  requireUser(actor, AudioError);
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
  limits?: Partial<AudioUploadLimits>;
  now?: () => Date;
  newId?: () => string;
}) {
  const { store, blobs } = deps;
  const limits = { ...DEFAULT_AUDIO_UPLOAD_LIMITS, ...deps.limits };
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());

  /** La subida existe y es del actor. */
  async function requireReadable(actor: Actor, id: string): Promise<AudioAssetRow> {
    requireSession(actor);
    const asset = z.uuid().safeParse(id).success ? await store.findAsset(id) : null;
    if (!asset) throw new AudioError("NOT_FOUND", "Audio no encontrado");
    if (asset.ownerId !== actor.userId) {
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

  /** Resuelve una referencia, o lanza el motivo por el que no es usable. */
  async function resolveRef(actor: Actor, value: string): Promise<ResolvedAudio> {
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
     * Sube un MP3 propio: valida tipo real, tamaño y duración y queda
     * `approved`, disponible al instante (decisión de 2026-09-26, ADR-039).
     */
    async uploadAudio(actor: Actor, input: AudioUploadInput): Promise<AudioAssetRow> {
      requireSession(actor);
      const { durationMs } = validateUpload(input);
      const filename = cleanFilename(input.filename);

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

    /** Metadatos + URL de escucha firmada (solo el dueño). */
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

    /**
     * Comprueba que el actor puede usar una referencia (`library:`/`upload:`).
     * Lanza `FORBIDDEN` (audio de otro usuario) o `AUDIO_REJECTED` (con motivo,
     * solo audios rechazados por la extinta cola de moderación).
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
          await resolveRef(actor, ref);
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
  opts: { now?: () => Date } = {},
): AudioAssetStore & { rows: Map<string, AudioAssetRow> } {
  const now = opts.now ?? (() => new Date());
  const rows = new Map<string, AudioAssetRow>();
  return {
    rows,
    async insertAsset(asset) {
      const row: AudioAssetRow = {
        ...asset,
        source: asset.source ?? "upload",
        generationText: asset.generationText ?? null,
        generationVoiceId: asset.generationVoiceId ?? null,
        generationCreditsCost: asset.generationCreditsCost ?? null,
        status: "approved",
        rejectionReason: null,
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
    async deleteAsset(id) {
      rows.delete(id);
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
