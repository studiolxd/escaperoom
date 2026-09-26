import { isLanguageCode } from "../schemas/localized-text";
import { MAX_INTRO_SUBTITLES_BYTES, MAX_INTRO_VIDEO_BYTES } from "../schemas/limits";
import type { ReadableIssue } from "../schemas/errors";
import type { RoomIntro } from "../schemas/roompackage";
import type { Actor } from "./actor";
import { isUuid, requireUser } from "./common";

/**
 * Medios de la introducción de una sala (encargo lobby-diseño, specs/04
 * "Introducción: vídeo y subtítulos"): el vídeo (mp4/webm, hasta
 * `MAX_INTRO_VIDEO_BYTES`, sin límite de duración) y los subtítulos WebVTT por
 * idioma. Sin moderación previa (decisión del usuario, como el audio en
 * ADR-039): el control es posterior, por reportes.
 *
 * - **Vídeo por PUT presignado**: 200 MB no deben pasar por la memoria del
 *   servidor. `createVideoUpload` reserva el asset (`pending`) y firma un PUT
 *   directo al bucket (R2 no admite presigned POST, ver `kit/storage`);
 *   `completeVideoUpload` comprueba el objeto REAL (HEAD: tamaño; GET por
 *   rango: magic bytes) antes de marcarlo `ready`. Si no cuadra, se borra.
 * - **Vídeo en el cuerpo** (`uploadVideoBytes`, meta-tool `upload` del MCP):
 *   mismas comprobaciones sobre los bytes recibidos; nace `ready`.
 * - **Subtítulos** (`uploadSubtitles`): WebVTT UTF-8 pequeño, en el cuerpo.
 *
 * Referencias: el borrador usa `media:<uuid>` (`introMediaRef`); una versión
 * publicada, `r2://assets/rooms/<roomId>/<sha256>.<ext>` (la publicación copia
 * el objeto a una clave direccionada por contenido y reescribe la referencia,
 * igual que con los audios `upload:`). `resolveMediaRef` traduce cualquiera de
 * las dos a una clave del bucket, con la autorización que toque.
 */

export type IntroMediaKind = "video" | "subtitles";
export type IntroMediaStatus = "pending" | "ready";

/** Fila persistida de `introMediaAsset` (migración 20260926160000_intro_media_asset). */
export type IntroMediaAssetRow = {
  id: string;
  ownerId: string;
  roomId: string;
  kind: IntroMediaKind;
  /** Idioma de los subtítulos; `null` en el vídeo. */
  lang: string | null;
  storageKey: string;
  contentType: string;
  /** Declarado mientras está `pending`; el real del objeto una vez `ready`. */
  byteSize: number;
  status: IntroMediaStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type NewIntroMediaAsset = Omit<IntroMediaAssetRow, "createdAt" | "updatedAt">;

export type IntroMediaRoomRef = { id: string; authorId: string };

/** Puerto de persistencia (ADR-022). */
export interface IntroMediaStore {
  /** `null` si la sala no existe o está borrada. */
  findRoom(roomId: string): Promise<IntroMediaRoomRef | null>;
  insertAsset(asset: NewIntroMediaAsset): Promise<IntroMediaAssetRow>;
  findAsset(id: string): Promise<IntroMediaAssetRow | null>;
  /** `pending` → `ready` con el tamaño real del objeto. */
  markReady(id: string, byteSize: number): Promise<IntroMediaAssetRow>;
  deleteAsset(id: string): Promise<void>;
}

/** Puerto de almacenamiento (el adaptador S3/R2 de `@escaperoom/kit/storage`). */
export interface IntroMediaBlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** PUT presignado (firma `content-type` y `content-length`). */
  signedUploadUrl(
    key: string,
    opts: { contentType: string; contentLength: number },
  ): Promise<{ url: string; headers: Record<string, string> }>;
  /** HEAD; `null` si el objeto no existe. */
  head(key: string): Promise<{ byteSize: number; contentType: string } | null>;
  /** Bytes `[start, end]` (inclusive). */
  readRange(key: string, start: number, end: number): Promise<Uint8Array>;
  /** URL de lectura firmada (bucket privado). */
  signedReadUrl(key: string, opts?: { expiresIn?: number }): Promise<string>;
}

export type IntroMediaErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  /** El objeto aún no está en el bucket (se llamó a `complete` antes de terminar el PUT). */
  | "UPLOAD_INCOMPLETE"
  /** El asset existe pero no está `ready` (subida sin completar). */
  | "NOT_READY";

/** Error de dominio; los adaptadores lo traducen a HTTP/MCP. */
export class IntroMediaError extends Error {
  readonly code: IntroMediaErrorCode;
  readonly issues: ReadableIssue[];
  constructor(
    code: IntroMediaErrorCode,
    message: string,
    extra: { issues?: ReadableIssue[] } = {},
  ) {
    super(message);
    this.name = "IntroMediaError";
    this.code = code;
    this.issues = extra.issues ?? [];
  }
}

export type IntroMediaLimits = { maxVideoBytes: number; maxSubtitlesBytes: number };

export const DEFAULT_INTRO_MEDIA_LIMITS: IntroMediaLimits = {
  maxVideoBytes: MAX_INTRO_VIDEO_BYTES,
  maxSubtitlesBytes: MAX_INTRO_SUBTITLES_BYTES,
};

/** Tipos de vídeo admitidos (MIME declarado → extensión de la clave). */
export const INTRO_VIDEO_TYPES = { "video/mp4": "mp4", "video/webm": "webm" } as const;
export type IntroVideoType = keyof typeof INTRO_VIDEO_TYPES;

export const INTRO_SUBTITLES_CONTENT_TYPE = "text/vtt";

/** Vida de la URL firmada del PUT de subida. */
export const INTRO_VIDEO_UPLOAD_TTL_SECONDS = 15 * 60;

/** Bytes que se leen del principio del objeto para el sniff. */
const SNIFF_BYTES = 16;

const MEDIA_REF_PREFIX = "media:";
const PUBLISHED_REF_PREFIX = "r2://";
/** Clave publicada de un medio de la introducción (la escribe `room-publish`). */
const PUBLISHED_KEY_RE = /^assets\/rooms\/[0-9a-f-]{36}\/[0-9a-f]{64}\.(mp4|webm|vtt)$/;

/** Referencia de borrador de un asset (`media:<uuid>`). */
export const introMediaRef = (id: string): string => `${MEDIA_REF_PREFIX}${id}`;

/** Id del asset de una referencia `media:<uuid>`, o `null` si no lo es. */
export function parseIntroMediaRef(ref: string): string | null {
  if (!ref.startsWith(MEDIA_REF_PREFIX)) return null;
  const id = ref.slice(MEDIA_REF_PREFIX.length);
  return isUuid(id) ? id.toLowerCase() : null;
}

/** ¿Es una referencia de borrador (`media:…`, válida o no)? */
export const isIntroMediaDraftRef = (ref: string): boolean => ref.startsWith(MEDIA_REF_PREFIX);

/**
 * Clave del bucket de una referencia publicada (`r2://assets/rooms/…`), o
 * `null`. Solo se aceptan claves con la forma exacta que escribe la
 * publicación: un borrador no puede colar `r2://uploads/…` para leer objetos
 * ajenos del bucket privado.
 */
export function parsePublishedIntroMediaRef(ref: string): string | null {
  if (!ref.startsWith(PUBLISHED_REF_PREFIX)) return null;
  const key = ref.slice(PUBLISHED_REF_PREFIX.length);
  return PUBLISHED_KEY_RE.test(key) ? key : null;
}

/** Referencias de medios de `meta.intro` (vídeo y subtítulos), en orden estable. */
export function introMediaRefsOf(intro: RoomIntro | undefined): string[] {
  if (!intro || intro.type !== "video") return [];
  const refs = [intro.video];
  for (const lang of Object.keys(intro.subtitles ?? {}).sort()) refs.push(intro.subtitles![lang]!);
  return refs;
}

/** Tipo real del vídeo por sus magic bytes: `ftyp` en el offset 4 (mp4) o EBML (webm). */
export function sniffIntroVideoType(bytes: Uint8Array): IntroVideoType | null {
  if (
    bytes.byteLength >= 8 &&
    bytes[4] === 0x66 && // f
    bytes[5] === 0x74 && // t
    bytes[6] === 0x79 && // y
    bytes[7] === 0x70 // p
  ) {
    return "video/mp4";
  }
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "video/webm";
  }
  return null;
}

/**
 * Texto de un WebVTT válido para servir, o `null`: UTF-8 estricto y cabecera
 * `WEBVTT` (tras un BOM opcional) seguida de fin, espacio, tabulador o salto
 * de línea (W3C WebVTT §4.1).
 */
export function parseWebVtt(bytes: Uint8Array): string | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
  return /^WEBVTT(?:$|[ \t\r\n])/.test(text) ? text : null;
}

function formatMb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function normalizeType(contentType: string): string {
  return contentType.split(";")[0]!.trim().toLowerCase();
}

/**
 * Tipo de vídeo declarado, admitiendo el `application/octet-stream`/vacío de
 * los navegadores que no infieren el MIME (se decide entonces por la
 * extensión; el contenido se verifica aparte).
 */
function declaredVideoType(contentType: string, filename: string): IntroVideoType | null {
  const declared = normalizeType(contentType);
  if (declared in INTRO_VIDEO_TYPES) return declared as IntroVideoType;
  if (declared === "" || declared === "application/octet-stream") {
    if (/\.mp4$/i.test(filename)) return "video/mp4";
    if (/\.webm$/i.test(filename)) return "video/webm";
  }
  return null;
}

/**
 * Cómo se autoriza la resolución de una referencia (`resolveMediaRef`):
 * - `null` (versión publicada, cualquier jugador): solo claves publicadas.
 * - `Actor` (editor): además, los `media:` propios y `ready`.
 * - `{ roomId }` (playtest de un borrador que QUIEN LLAMA ya autorizó):
 *   además, los `media:` `ready` subidos por el autor de esa sala.
 */
export type IntroMediaAccess = Actor | { roomId: string } | null;

export type VideoUploadInput = { filename: string; contentType: string; byteSize: number };

export type VideoUploadTicket = {
  assetId: string;
  /** PUT directo al bucket (caduca en `INTRO_VIDEO_UPLOAD_TTL_SECONDS`). */
  uploadUrl: string;
  /** Cabeceras que el cliente debe mandar tal cual en el PUT. */
  headers: Record<string, string>;
};

export function createIntroMediaService(deps: {
  store: IntroMediaStore;
  blobs: IntroMediaBlobStore;
  limits?: Partial<IntroMediaLimits>;
  newId?: () => string;
}) {
  const { store, blobs } = deps;
  const limits = { ...DEFAULT_INTRO_MEDIA_LIMITS, ...deps.limits };
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());

  /** Solo el autor de la sala sube o gestiona los medios de su introducción. */
  async function requireAuthor(actor: Actor, roomId: string): Promise<IntroMediaRoomRef> {
    requireUser(actor, IntroMediaError);
    const room = isUuid(roomId) ? await store.findRoom(roomId) : null;
    if (!room) throw new IntroMediaError("NOT_FOUND", "La sala no existe");
    if (room.authorId !== actor.userId) {
      throw new IntroMediaError(
        "FORBIDDEN",
        "Solo el autor puede cambiar la introducción de la sala",
      );
    }
    return room;
  }

  function checkVideoSize(byteSize: number): void {
    if (!Number.isInteger(byteSize) || byteSize <= 0) {
      throw new IntroMediaError("VALIDATION_ERROR", "El fichero está vacío", {
        issues: [{ path: "byteSize", message: "Debe ser un entero positivo" }],
      });
    }
    if (byteSize > limits.maxVideoBytes) {
      throw new IntroMediaError(
        "PAYLOAD_TOO_LARGE",
        `El vídeo ocupa ${formatMb(byteSize)}; el máximo es ${formatMb(limits.maxVideoBytes)}`,
      );
    }
  }

  function requireVideoType(contentType: string, filename: string): IntroVideoType {
    const type = declaredVideoType(contentType, filename);
    if (!type) {
      throw new IntroMediaError(
        "UNSUPPORTED_MEDIA_TYPE",
        "Solo se aceptan vídeos MP4 (H.264) o WebM",
      );
    }
    return type;
  }

  const videoKey = (roomId: string, id: string, type: IntroVideoType) =>
    `uploads/intro/${roomId}/${id}.${INTRO_VIDEO_TYPES[type]}`;

  /** El asset existe, es de esa sala y del actor (si no, "no encontrado": no se revelan ids ajenos). */
  async function requireOwnAsset(
    actor: Actor,
    roomId: string,
    assetId: string,
  ): Promise<IntroMediaAssetRow> {
    const asset = isUuid(assetId) ? await store.findAsset(assetId.toLowerCase()) : null;
    if (!asset || asset.roomId !== roomId || asset.ownerId !== actor.userId) {
      throw new IntroMediaError("NOT_FOUND", "Medio no encontrado");
    }
    return asset;
  }

  async function resolveMediaRef(access: IntroMediaAccess, ref: string): Promise<string> {
    const published = parsePublishedIntroMediaRef(ref);
    if (published) return published;
    const id = parseIntroMediaRef(ref);
    if (!id)
      throw new IntroMediaError("VALIDATION_ERROR", `Referencia de medio no válida: "${ref}"`);
    if (access === null) {
      // Una versión publicada nunca lleva `media:` (la publicación los reescribe).
      throw new IntroMediaError("FORBIDDEN", "Referencia de borrador fuera del editor");
    }
    const asset = await store.findAsset(id);
    if (!asset) throw new IntroMediaError("NOT_FOUND", "Medio no encontrado");
    if ("roomId" in access) {
      const room = isUuid(access.roomId) ? await store.findRoom(access.roomId) : null;
      if (!room || asset.ownerId !== room.authorId) {
        throw new IntroMediaError("FORBIDDEN", "El medio no es del autor de la sala");
      }
    } else {
      requireUser(access, IntroMediaError);
      if (asset.ownerId !== access.userId) {
        throw new IntroMediaError("FORBIDDEN", "No puedes usar un medio subido por otro usuario");
      }
    }
    if (asset.status !== "ready") {
      throw new IntroMediaError("NOT_READY", "La subida del vídeo no se ha completado");
    }
    return asset.storageKey;
  }

  return {
    limits,

    /** Solo el guard de sesión (los adaptadores lo usan antes de leer el cuerpo). */
    authorize(actor: Actor): void {
      requireUser(actor, IntroMediaError);
    },

    /**
     * Reserva un vídeo (`pending`) y firma el PUT directo al bucket. Valida el
     * tipo DECLARADO y el tamaño declarado; el contenido real se comprueba en
     * `completeVideoUpload`.
     */
    async createVideoUpload(
      actor: Actor,
      roomId: string,
      input: VideoUploadInput,
    ): Promise<VideoUploadTicket> {
      const room = await requireAuthor(actor, roomId);
      const type = requireVideoType(input.contentType, input.filename);
      checkVideoSize(input.byteSize);
      const id = newId();
      const storageKey = videoKey(room.id, id, type);
      await store.insertAsset({
        id,
        ownerId: actor.userId,
        roomId: room.id,
        kind: "video",
        lang: null,
        storageKey,
        contentType: type,
        byteSize: input.byteSize,
        status: "pending",
      });
      const { url, headers } = await blobs.signedUploadUrl(storageKey, {
        contentType: type,
        contentLength: input.byteSize,
      });
      return { assetId: id, uploadUrl: url, headers };
    },

    /**
     * Comprueba el objeto subido por el PUT (HEAD: tamaño ≤ límite; GET por
     * rango: magic bytes del tipo declarado) y lo marca `ready`. Si no cuadra,
     * borra el objeto y el asset (hay que empezar otra subida). Idempotente
     * sobre un asset ya `ready`.
     */
    async completeVideoUpload(
      actor: Actor,
      roomId: string,
      assetId: string,
    ): Promise<{ ref: string }> {
      const room = await requireAuthor(actor, roomId);
      const asset = await requireOwnAsset(actor, room.id, assetId);
      if (asset.kind !== "video") throw new IntroMediaError("NOT_FOUND", "Medio no encontrado");
      if (asset.status === "ready") return { ref: introMediaRef(asset.id) };

      const head = await blobs.head(asset.storageKey);
      if (!head) {
        throw new IntroMediaError(
          "UPLOAD_INCOMPLETE",
          "El vídeo aún no está subido: termina el PUT antes de completar",
        );
      }
      const discard = async (error: IntroMediaError): Promise<never> => {
        await blobs.delete(asset.storageKey).catch(() => undefined);
        await store.deleteAsset(asset.id);
        throw error;
      };
      if (head.byteSize <= 0) {
        return discard(new IntroMediaError("VALIDATION_ERROR", "El fichero está vacío"));
      }
      if (head.byteSize > limits.maxVideoBytes) {
        return discard(
          new IntroMediaError(
            "PAYLOAD_TOO_LARGE",
            `El vídeo ocupa ${formatMb(head.byteSize)}; el máximo es ${formatMb(limits.maxVideoBytes)}`,
          ),
        );
      }
      const start = await blobs.readRange(
        asset.storageKey,
        0,
        Math.min(SNIFF_BYTES, head.byteSize) - 1,
      );
      if (sniffIntroVideoType(start) !== asset.contentType) {
        return discard(
          new IntroMediaError(
            "UNSUPPORTED_MEDIA_TYPE",
            "El contenido no es un vídeo MP4 o WebM válido (o no coincide con el tipo declarado)",
          ),
        );
      }
      const ready = await store.markReady(asset.id, head.byteSize);
      return { ref: introMediaRef(ready.id) };
    },

    /**
     * Vídeo que llega en el propio cuerpo (meta-tool `upload` del MCP): mismo
     * límite y sniff que el PUT presignado; nace `ready`.
     */
    async uploadVideoBytes(
      actor: Actor,
      roomId: string,
      input: { filename: string; contentType: string; bytes: Uint8Array },
    ): Promise<{ ref: string }> {
      const room = await requireAuthor(actor, roomId);
      const type = requireVideoType(input.contentType, input.filename);
      checkVideoSize(input.bytes.byteLength);
      if (sniffIntroVideoType(input.bytes.subarray(0, SNIFF_BYTES)) !== type) {
        throw new IntroMediaError(
          "UNSUPPORTED_MEDIA_TYPE",
          "El contenido no es un vídeo MP4 o WebM válido (o no coincide con el tipo declarado)",
        );
      }
      const id = newId();
      const storageKey = videoKey(room.id, id, type);
      await blobs.put(storageKey, input.bytes, type);
      try {
        await store.insertAsset({
          id,
          ownerId: actor.userId,
          roomId: room.id,
          kind: "video",
          lang: null,
          storageKey,
          contentType: type,
          byteSize: input.bytes.byteLength,
          status: "ready",
        });
      } catch (err) {
        await blobs.delete(storageKey).catch(() => undefined);
        throw err;
      }
      return { ref: introMediaRef(id) };
    },

    /** Subtítulos WebVTT de un idioma (UTF-8, cabecera `WEBVTT`, ≤ `maxSubtitlesBytes`). */
    async uploadSubtitles(
      actor: Actor,
      roomId: string,
      input: { lang: string; bytes: Uint8Array },
    ): Promise<{ ref: string }> {
      const room = await requireAuthor(actor, roomId);
      const lang = input.lang.trim();
      if (!isLanguageCode(lang)) {
        throw new IntroMediaError(
          "VALIDATION_ERROR",
          `Código de idioma no válido: "${input.lang}"`,
          {
            issues: [{ path: "lang", message: "Código de idioma inválido" }],
          },
        );
      }
      if (input.bytes.byteLength === 0) {
        throw new IntroMediaError("VALIDATION_ERROR", "El fichero está vacío");
      }
      if (input.bytes.byteLength > limits.maxSubtitlesBytes) {
        throw new IntroMediaError(
          "PAYLOAD_TOO_LARGE",
          `Los subtítulos ocupan ${Math.ceil(input.bytes.byteLength / 1024)} KB; el máximo es ${Math.floor(limits.maxSubtitlesBytes / 1024)} KB`,
        );
      }
      if (parseWebVtt(input.bytes) === null) {
        throw new IntroMediaError(
          "UNSUPPORTED_MEDIA_TYPE",
          "Los subtítulos deben ser un WebVTT en UTF-8 (empezar por «WEBVTT»)",
        );
      }
      const id = newId();
      const storageKey = `uploads/intro/${room.id}/${id}.vtt`;
      await blobs.put(storageKey, input.bytes, INTRO_SUBTITLES_CONTENT_TYPE);
      try {
        await store.insertAsset({
          id,
          ownerId: actor.userId,
          roomId: room.id,
          kind: "subtitles",
          lang,
          storageKey,
          contentType: INTRO_SUBTITLES_CONTENT_TYPE,
          byteSize: input.bytes.byteLength,
          status: "ready",
        });
      } catch (err) {
        await blobs.delete(storageKey).catch(() => undefined);
        throw err;
      }
      return { ref: introMediaRef(id) };
    },

    /**
     * Clave del bucket de una referencia (`media:<uuid>` listo, o clave
     * publicada), con la autorización de `access`. Lanza `IntroMediaError`.
     */
    resolveMediaRef,

    /** Asset listo de una referencia `media:` (tipo y clave, para empaquetar al publicar). */
    async resolveDraftAsset(actor: Actor, ref: string): Promise<IntroMediaAssetRow> {
      await resolveMediaRef(actor, ref);
      const asset = await store.findAsset(parseIntroMediaRef(ref)!);
      if (!asset) throw new IntroMediaError("NOT_FOUND", "Medio no encontrado");
      return asset;
    },

    /**
     * URL firmada de una referencia para la previsualización del editor (solo
     * el autor de la sala: sus `media:` o las claves publicadas).
     */
    async previewUrl(
      actor: Actor,
      roomId: string,
      ref: string,
      opts: { expiresIn?: number } = {},
    ): Promise<string> {
      await requireAuthor(actor, roomId);
      const key = await resolveMediaRef(actor, ref);
      return blobs.signedReadUrl(key, opts);
    },

    /** URL firmada de una clave ya resuelta (el resolver de partida/playtest). */
    signedUrl(key: string, opts: { expiresIn?: number } = {}): Promise<string> {
      return blobs.signedReadUrl(key, opts);
    },
  };
}

export type IntroMediaService = ReturnType<typeof createIntroMediaService>;

/**
 * Resolver `(ref) => URL firmada | null` para `resolveIntroModel` (web): nunca
 * lanza — un medio que no se puede servir hace que la partida siga sin
 * introducción de vídeo (o sin esa pista de subtítulos).
 */
export function createIntroMediaUrlResolver(
  service: Pick<IntroMediaService, "resolveMediaRef" | "signedUrl">,
  access: IntroMediaAccess,
  opts: { expiresIn?: number } = {},
): (ref: string) => Promise<string | null> {
  return async (ref) => {
    try {
      const key = await service.resolveMediaRef(access, ref);
      return await service.signedUrl(key, opts);
    } catch {
      return null;
    }
  };
}

/** Store en memoria (tests y superficies sin base de datos). */
export function createInMemoryIntroMediaStore(rooms: IntroMediaRoomRef[] = []): IntroMediaStore & {
  rows: Map<string, IntroMediaAssetRow>;
  rooms: Map<string, IntroMediaRoomRef>;
} {
  const rows = new Map<string, IntroMediaAssetRow>();
  const roomById = new Map(rooms.map((r) => [r.id, { ...r }]));
  let clock = Date.UTC(2026, 8, 26);
  return {
    rows,
    rooms: roomById,
    async findRoom(roomId) {
      const room = roomById.get(roomId);
      return room ? { ...room } : null;
    },
    async insertAsset(asset) {
      if ([...rows.values()].some((r) => r.storageKey === asset.storageKey)) {
        throw new Error(`UNIQUE storageKey violado: ${asset.storageKey}`);
      }
      const at = new Date((clock += 1000));
      const row: IntroMediaAssetRow = { ...asset, createdAt: at, updatedAt: at };
      rows.set(row.id, row);
      return { ...row };
    },
    async findAsset(id) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async markReady(id, byteSize) {
      const row = rows.get(id);
      if (!row) throw new Error(`No existe ${id}`);
      const updated = {
        ...row,
        status: "ready" as const,
        byteSize,
        updatedAt: new Date((clock += 1000)),
      };
      rows.set(id, updated);
      return { ...updated };
    },
    async deleteAsset(id) {
      rows.delete(id);
    },
  };
}

/** Bucket en memoria (tests): el PUT presignado se simula con `simulatePut`. */
export function createInMemoryIntroMediaBlobStore(): IntroMediaBlobStore & {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
  simulatePut(key: string, bytes: Uint8Array, contentType: string): void;
} {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    simulatePut(key, bytes, contentType) {
      objects.set(key, { bytes: bytes.slice(), contentType });
    },
    async put(key, bytes, contentType) {
      objects.set(key, { bytes: bytes.slice(), contentType });
    },
    async delete(key) {
      objects.delete(key);
    },
    async signedUploadUrl(key, { contentType }) {
      return { url: `memory-put://${key}`, headers: { "Content-Type": contentType } };
    },
    async head(key) {
      const o = objects.get(key);
      return o ? { byteSize: o.bytes.byteLength, contentType: o.contentType } : null;
    },
    async readRange(key, start, end) {
      const o = objects.get(key);
      if (!o) throw new Error(`No existe ${key}`);
      return o.bytes.slice(start, end + 1);
    },
    async signedReadUrl(key, opts = {}) {
      if (!objects.has(key)) throw new Error(`No existe ${key}`);
      return `memory://${key}?expiresIn=${opts.expiresIn ?? 3600}`;
    },
  };
}
