import { createHash } from "node:crypto";
import type * as Y from "yjs";
import { safeParseRoomPackage, type RoomPackage } from "../schemas";
import { toReadableIssues, type ReadableIssue } from "../schemas/errors";
import {
  renderValidationReport,
  validateRoomPackage,
  type AssetManifestInput,
  type ValidationReport,
} from "../validator";
import { type Actor } from "./actor";
import type { AdminDirectory } from "./admin";
import type { AudioAssetService } from "./audio-assets";
import { UUID_RE, requireUser } from "./common";
import type { ModerationService, PublishPrecheck } from "./moderation";
import { buildDraftDoc, type RoomDraftTx } from "./room-draft";
import { classifyRoomPackageChange, type RoomPackageChange } from "./room-version-diff";

/**
 * Publicación de salas (ticket 3.9, specs/08 §5–6, specs/13 §4).
 *
 * Publicar = tomar el draft Yjs, serializarlo a `RoomPackage`, repetir el
 * validador en servidor (❌ bloquea), comprobar que los audios están aprobados
 * por moderación, empaquetar los assets en el bucket (claves direccionadas por
 * contenido) con un `assetsHash` determinista y congelar el resultado en una
 * fila INMUTABLE de `roomVersion`. Lo publicado nunca se reescribe: seguir
 * editando el draft no lo toca y cada publicación crea una versión nueva.
 */

// ── Puertos ────────────────────────────────────────────────────────────────

/**
 * Serialización doc Yjs → `RoomPackage` (candidato; se valida con Zod aquí).
 *
 * **Contrato para el ticket 3.1** (mapeo del mapa/objetos del doc): la
 * publicación NO conoce el layout del doc; recibe una implementación de este
 * puerto. Debe devolver el `RoomPackage` completo tal cual lo definen los
 * esquemas de `@escaperoom/shared/schemas`, con `meta.packageFormat` a un valor
 * de `SUPPORTED_PACKAGE_FORMATS` y los audios como referencias `library:`/
 * `upload:` (3.11) en `LocalizedText.audioUrl`. `meta.id`, `meta.authorId` y
 * `meta.version` los fija el servidor al congelar (lo que traiga el doc se
 * ignora). Es síncrono y puro: no debe mutar el doc.
 */
export type RoomPackageSerializer = (
  doc: Y.Doc,
  room: { roomId: string; authorId: string },
) => unknown;

/** Motivo por el que una referencia de asset no se puede publicar. */
export type PublishAssetProblem = {
  ref: string;
  /** p. ej. `AUDIO_PENDING_MODERATION`, `AUDIO_REJECTED`, `FORBIDDEN`. */
  code: string;
  message: string;
  rejectionReason: string | null;
};

/**
 * Origen de los assets del creador referenciados por el draft. Su
 * `checkRefsForPublish` tiene la misma forma que el de `AudioAssetService`
 * (3.11): un audio pendiente o rechazado en moderación bloquea la publicación.
 */
export interface PublishAssetSource {
  /** Revisa las referencias; no lanza: devuelve los problemas (vacío = todo publicable). */
  checkRefsForPublish(actor: Actor, refs: readonly string[]): Promise<PublishAssetProblem[]>;
  /** Bytes del asset ya comprobado (el servicio solo lo llama si no hubo problemas). */
  load(actor: Actor, ref: string): Promise<{ bytes: Uint8Array; contentType: string }>;
}

/** Almacenamiento de objetos (R2/S3 en producción, en memoria en tests). */
export interface PublishedAssetStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export type PublishRoomRef = {
  id: string;
  authorId: string;
  status: "draft" | "published" | "unlisted" | "archived" | "removed";
};

/** Fila de `roomVersion` (el `package` es el JSONB congelado). */
export type RoomVersionRow = {
  id: string;
  roomId: string;
  semver: string;
  package: RoomPackage;
  assetsHash: string;
  changelog: string | null;
  publishedBy: string;
  publishedAt: Date;
};

export type NewRoomVersion = Omit<RoomVersionRow, "id" | "publishedAt">;

/** Metadata pública de una versión (nunca el `package`, specs/13 §3). */
export type RoomVersionMeta = {
  id: string;
  semver: string;
  changelog: string | null;
  packageFormat: string;
  assetsHash: string;
  publishedAt: Date;
};

/** Operaciones dentro del lock de la sala. */
export interface RoomPublishTx {
  /** `semver` de todas las versiones de la sala (para calcular la siguiente). */
  listSemvers(roomId: string): Promise<string[]>;
  /** Última versión publicada (`package` incluido, para clasificar el cambio), o `null` sin ninguna. */
  findLatestVersion(roomId: string): Promise<RoomVersionRow | null>;
  insertVersion(version: NewRoomVersion): Promise<RoomVersionRow>;
  /** `draft` → `published` en la primera publicación; otros estados no cambian. */
  markPublished(roomId: string): Promise<void>;
}

/**
 * Puerto de persistencia de la publicación. `withRoomLock` serializa las
 * publicaciones de una misma sala (Postgres: `SELECT … FOR UPDATE` sobre
 * `room`), de modo que dos publicaciones simultáneas obtienen semver distintos.
 */
export interface RoomPublishStore
  extends AdminDirectory,
    Pick<RoomPublishTx, "listSemvers" | "findLatestVersion"> {
  findRoom(roomId: string): Promise<PublishRoomRef | null>;
  listVersions(roomId: string): Promise<RoomVersionMeta[]>;
  findVersion(roomId: string, versionId: string): Promise<RoomVersionRow | null>;
  withRoomLock<T>(roomId: string, fn: (tx: RoomPublishTx) => Promise<T>): Promise<T>;
}

/**
 * Moderación en la publicación (ticket 6.1, specs/17 §3 y §6): el creador
 * congelado, suspendido o baneado no publica, y el contenido pasa el pre-check
 * automático (🛑 bloquea con un reporte apelable; 🟡 publica y lo encola).
 */
export type PublishModerationGate = Pick<
  ModerationService,
  "publishBlocker" | "precheckPublish" | "recordPrecheckFlags"
>;

/** Lectura del draft (el mismo puerto que usa `RoomDraftService`). */
export type PublishDraftReader = Pick<RoomDraftTx, "latestSnapshot" | "updatesAfter">;

// ── Errores ────────────────────────────────────────────────────────────────

export type RoomPublishErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "VERSION_CONFLICT"
  /** El paquete candidato es idéntico al de la última versión publicada (ADR-035). */
  | "NOTHING_TO_PUBLISH"
  | "ROOM_NOT_PUBLISHABLE"
  | "INVALID_PACKAGE"
  | "UNSUPPORTED_PACKAGE_FORMAT"
  | "VALIDATION_FAILED"
  | "ASSETS_NOT_PUBLISHABLE"
  | "SERIALIZER_UNAVAILABLE"
  /** El draft ya no es el que se aprobó (`PublishGuard.packageHash`, ticket 4.5). */
  | "DRAFT_CHANGED"
  /** Se publicó otra versión desde que se aprobó (`PublishGuard.latestSemver`, ticket 4.5). */
  | "VERSION_CHANGED"
  /** Moderación (6.1): cuenta congelada por un reporte crítico pendiente. */
  | "ACCOUNT_FROZEN"
  /** Moderación (6.1): 2º strike en 90 días, publicación suspendida 14 días. */
  | "CREATOR_SUSPENDED"
  /** Moderación (6.1): ban como creador. */
  | "CREATOR_BANNED"
  /** Moderación (6.1): el pre-check automático bloqueó el contenido (apelable). */
  | "CONTENT_BLOCKED";

export type RoomPublishErrorDetails = {
  /** Campos inválidos (entrada o `RoomPackage` que no cumple el esquema). */
  issues?: ReadableIssue[];
  /** Informe del validador cuando `code === "VALIDATION_FAILED"`. */
  report?: ValidationReport;
  /** El mismo informe renderizado en texto (✅/🟡/❌). */
  reportText?: string;
  /** Assets que bloquean cuando `code === "ASSETS_NOT_PUBLISHABLE"`. */
  problems?: PublishAssetProblem[];
  /** Detalle de moderación (bloqueo del pre-check o restricción de la cuenta). */
  moderation?: {
    /** Reporte `precheck` que se puede apelar (`POST /api/rooms/:roomId/appeal`). */
    reportId?: string | null;
    findings?: PublishPrecheck["findings"];
    until?: Date | null;
  };
};

/** Error de dominio de la publicación; los adaptadores lo traducen a HTTP/tRPC/MCP. */
export class RoomPublishError extends Error {
  readonly code: RoomPublishErrorCode;
  readonly details: RoomPublishErrorDetails;
  constructor(code: RoomPublishErrorCode, message: string, details: RoomPublishErrorDetails = {}) {
    super(message);
    this.name = "RoomPublishError";
    this.code = code;
    this.details = details;
  }
}

// ── Piezas puras ───────────────────────────────────────────────────────────

/**
 * Valores de `meta.packageFormat` que el servidor sabe publicar (specs/08 §6:
 * valor fijado `"roompackage/v1"`, el que usa el fixture del Rey Aldric). Un
 * bump breaking del formato añade aquí el nuevo valor cuando el runtime lo
 * soporte.
 */
export const SUPPORTED_PACKAGE_FORMATS: readonly string[] = ["roompackage/v1"];

/** Longitud máxima del changelog de una versión. */
export const MAX_CHANGELOG_LENGTH = 5000;

const SEMVER_RE = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
/** Referencias de asset del creador que se empaquetan (3.11: `library:`/`upload:`). */
const ASSET_REF_RE = /^(library|upload):\S+$/;

type Semver = [number, number, number];

/** `[major, minor, patch]` de un semver `X.Y.Z`, o `null` si no lo es. */
export function parseSemver(value: string): Semver | null {
  const m = SEMVER_RE.exec(value);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareSemver(a: Semver, b: Semver): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Mayor semver publicado (`X.Y.Z`), o `null` si la sala no tiene versiones. */
export function latestSemver(existing: readonly string[]): string | null {
  const parsed = existing.map(parseSemver).filter((v): v is Semver => v !== null);
  const latest = parsed.sort(compareSemver).at(-1);
  return latest ? latest.join(".") : null;
}

/**
 * Semver de la próxima versión, a partir de cómo cambió el contenido
 * respecto a la última versión publicada (`classifyRoomPackageChange`,
 * ADR-035): `1.0.0` en la primera publicación; si no, MAJOR/MINOR/PATCH ponen
 * a cero los componentes inferiores (`2.3.4` + MAJOR → `3.0.0`; + MINOR →
 * `2.4.0`; + PATCH → `2.3.5`). `"none"` (nada cambió) no tiene semver
 * siguiente: se rechaza con `NOTHING_TO_PUBLISH`.
 */
export function nextSemver(existing: readonly string[], change: RoomPackageChange): string {
  const parsed = existing.map(parseSemver).filter((v): v is Semver => v !== null);
  const latest = parsed.sort(compareSemver).at(-1) ?? null;
  if (!latest) return "1.0.0";
  switch (change) {
    case "major":
      return `${latest[0] + 1}.0.0`;
    case "minor":
      return `${latest[0]}.${latest[1] + 1}.0`;
    case "patch":
      return `${latest[0]}.${latest[1]}.${latest[2] + 1}`;
    case "none":
      throw new RoomPublishError(
        "NOTHING_TO_PUBLISH",
        "El contenido no ha cambiado desde la última versión publicada: no hay nada que publicar",
      );
  }
}

/**
 * Referencias de asset del creador (`audioUrl` de cualquier `LocalizedText`:
 * diálogos, pistas, textos de objetos…), únicas y ordenadas.
 */
export function collectAssetRefs(pkg: RoomPackage): string[] {
  const refs = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const v of value) walk(v);
    } else if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value)) {
        if (key === "audioUrl" && typeof v === "string" && ASSET_REF_RE.test(v)) refs.add(v);
        else walk(v);
      }
    }
  };
  walk(pkg);
  return [...refs].sort();
}

/** Sustituye cada `audioUrl` referenciado en `replacements` (devuelve una copia). */
export function rewriteAssetRefs(
  pkg: RoomPackage,
  replacements: ReadonlyMap<string, string>,
): RoomPackage {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [
          key,
          key === "audioUrl" && typeof v === "string" && replacements.has(v)
            ? replacements.get(v)
            : walk(v),
        ]),
      );
    }
    return value;
  };
  return walk(pkg) as RoomPackage;
}

const EXT_BY_TYPE: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "image/png": "png",
  "image/webp": "webp",
  "application/json": "json",
};

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** JSON con las claves de los objetos ordenadas (forma canónica para hashear). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Huella del contenido de un `RoomPackage` serializado del draft (ticket 4.5):
 * SHA-256 de su JSON canónico (claves ordenadas). Mismo contenido ⇒ misma
 * huella, sin depender del historial Yjs; cualquier cambio del draft que
 * altere lo que se publicaría la cambia.
 */
export function computePackageHash(pkg: RoomPackage): string {
  return `sha256:${sha256(canonicalJson(pkg))}`;
}

/** Asset empaquetado: clave direccionada por contenido dentro del bucket. */
export type PackagedAsset = {
  ref: string;
  key: string;
  sha256: string;
  contentType: string;
  byteSize: number;
};

/**
 * Clave del bucket de un asset publicado de la sala. Direccionada por
 * contenido: el mismo fichero siempre cae en la misma clave (subir dos veces
 * es idempotente) y un fichero publicado nunca se sobrescribe con otro.
 */
export function publishedAssetKey(roomId: string, digest: string, contentType: string): string {
  const ext = EXT_BY_TYPE[contentType.split(";")[0]!.trim().toLowerCase()] ?? "bin";
  return `assets/rooms/${roomId}/${digest}.${ext}`;
}

/**
 * `assetsHash` determinista de una versión: SHA-256 de una lista canónica
 * (ordenada) con el manifiesto del pack gráfico y el `sha256` de cada asset
 * empaquetado. No depende del orden de aparición, de las referencias del draft
 * ni de la fecha: mismo contenido ⇒ mismo hash; cambia un byte ⇒ cambia.
 */
export function computeAssetsHash(input: {
  assetsManifest: string;
  assets: ReadonlyArray<Pick<PackagedAsset, "key" | "sha256">>;
}): string {
  const lines = [
    `manifest\t${input.assetsManifest}`,
    ...input.assets.map((a) => `asset\t${a.key}\t${a.sha256}`).sort(),
  ];
  return `sha256:${sha256(lines.join("\n"))}`;
}

// ── Servicio ───────────────────────────────────────────────────────────────

export type PublishInput = { changelog?: string | null };

/**
 * Condiciones extra de una publicación (ticket 4.5, confirmación humana del
 * MCP): se publica solo si el draft y el histórico siguen siendo los que el
 * humano aprobó. Sin guard, `publish` se comporta como siempre (3.9).
 */
export type PublishGuard = {
  /** `computePackageHash` del draft aprobado; si difiere ⇒ `DRAFT_CHANGED`. */
  packageHash?: string;
  /**
   * Última versión publicada cuando se aprobó (`null` = ninguna). Se comprueba
   * dentro del lock de la sala: si difiere ⇒ `VERSION_CHANGED`. Hace que una
   * aprobación sirva para UNA publicación.
   */
  latestSemver?: string | null;
};

/** Resultado de `checkPublishable`: la sala publicaría así, pero no se ha escrito nada. */
export type PublishCheck = {
  roomId: string;
  title: string;
  /** `meta.defaultLanguage` del draft (para enlazar la web en su idioma). */
  defaultLanguage: string;
  packageHash: string;
  latestSemver: string | null;
  nextSemver: string;
  /** Informe del validador (sin ❌; puede traer avisos 🟡). */
  report: ValidationReport;
};

export type PublishResult = {
  version: RoomVersionMeta;
  /** Informe del validador (sin ❌; puede traer avisos 🟡). */
  report: ValidationReport;
  assets: PackagedAsset[];
  /** Señales 🟡 del pre-check de moderación (vacío si no hay o no está cableado). */
  moderationFlags: string[];
};

function parsePublishInput(input: unknown): PublishInput {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new RoomPublishError("VALIDATION_ERROR", "El cuerpo debe ser un objeto JSON");
  }
  const { changelog } = input as Record<string, unknown>;
  const issues: ReadableIssue[] = [];
  if (changelog !== undefined && changelog !== null && typeof changelog !== "string") {
    issues.push({ path: "changelog", message: "Debe ser un string" });
  } else if (typeof changelog === "string" && changelog.length > MAX_CHANGELOG_LENGTH) {
    issues.push({ path: "changelog", message: `Máximo ${MAX_CHANGELOG_LENGTH} caracteres` });
  }
  if (issues.length > 0)
    throw new RoomPublishError("VALIDATION_ERROR", "Datos no válidos", { issues });
  return {
    changelog: typeof changelog === "string" && changelog.trim() ? changelog.trim() : null,
  };
}

/** `VERSION_CHANGED` si el guard fija una última versión distinta de la actual. */
function checkLatestSemver(guard: PublishGuard | undefined, semvers: readonly string[]): void {
  if (guard?.latestSemver === undefined) return;
  const current = latestSemver(semvers);
  if (current !== guard.latestSemver) {
    throw new RoomPublishError(
      "VERSION_CHANGED",
      current
        ? `Ya se publicó la versión ${current} desde que se aprobó esta publicación: vuelve a solicitarla`
        : "El histórico de versiones cambió desde que se aprobó esta publicación: vuelve a solicitarla",
    );
  }
}

function toMeta(row: RoomVersionRow): RoomVersionMeta {
  return {
    id: row.id,
    semver: row.semver,
    changelog: row.changelog,
    packageFormat: row.package.meta.packageFormat,
    assetsHash: row.assetsHash,
    publishedAt: row.publishedAt,
  };
}

/**
 * Servicio de publicación. Autorización: solo el autor publica y lee el
 * `RoomPackage` de sus versiones (también un admin de plataforma); el
 * histórico de versiones (solo metadata) es público.
 */
export function createRoomPublishService(deps: {
  store: RoomPublishStore;
  drafts: PublishDraftReader;
  /** `null` mientras no exista el mapeo doc → RoomPackage (ticket 3.1). */
  serializer: RoomPackageSerializer | null;
  assets: PublishAssetSource;
  storage: PublishedAssetStorage;
  supportedPackageFormats?: readonly string[];
  /** Moderación (6.1). Sin ella (tests antiguos, superficies sin BD) no hay pre-check. */
  moderation?: PublishModerationGate;
  /**
   * Manifiesto del pack gráfico para el check `assets` del validador
   * (auditoría D-13): sin esto el check nunca comprobaba nada al publicar
   * ("Assets no comprobados"). Devuelve `undefined` si no hay manifiesto
   * (degrada a aviso, no bloquea): un clon limpio sin `pnpm pack:build` debe
   * poder publicar igual.
   */
  loadAssetManifest?: (pkg: RoomPackage) => Promise<AssetManifestInput | undefined>;
  /**
   * Smoke test de `@escaperoom/game-runtime` (`toRuntimeModel`, auditoría
   * D-3): `shared` no puede depender de `game-runtime` (sería una dependencia
   * circular), así que quien instancia el servicio inyecta la comprobación.
   * Debe lanzar si el paquete no carga en el runtime (posiciones fuera de la
   * rejilla, RLE inválido…); sin ella (tests, superficies sin runtime) no se
   * comprueba.
   */
  runtimeModelCheck?: (pkg: RoomPackage) => void;
}) {
  const { store, drafts, assets, storage } = deps;
  const supportedFormats = deps.supportedPackageFormats ?? SUPPORTED_PACKAGE_FORMATS;

  async function findRoom(roomId: string): Promise<PublishRoomRef> {
    const room = UUID_RE.test(roomId) ? await store.findRoom(roomId) : null;
    if (!room) throw new RoomPublishError("NOT_FOUND", "Sala no encontrada");
    return room;
  }

  async function authorizeAuthor(actor: Actor, roomId: string): Promise<PublishRoomRef> {
    requireUser(actor, RoomPublishError);
    const room = await findRoom(roomId);
    if (room.authorId !== actor.userId) {
      throw new RoomPublishError("FORBIDDEN", "Solo el autor puede publicar esta sala");
    }
    return room;
  }

  /** Draft actual → `RoomPackage` validado por esquema (sin congelar). */
  async function serializeDraft(room: PublishRoomRef): Promise<RoomPackage> {
    if (!deps.serializer) {
      throw new RoomPublishError(
        "SERIALIZER_UNAVAILABLE",
        "La serialización del draft a RoomPackage aún no está disponible",
      );
    }
    const snapshot = await drafts.latestSnapshot(room.id);
    const updates = await drafts.updatesAfter(room.id, snapshot?.updatesAppliedThrough ?? 0n);
    const doc = buildDraftDoc({ snapshot, updates });
    let candidate: unknown;
    try {
      candidate = deps.serializer(doc, { roomId: room.id, authorId: room.authorId });
    } finally {
      doc.destroy();
    }
    const parsed = safeParseRoomPackage(candidate);
    if (!parsed.success) {
      throw new RoomPublishError("INVALID_PACKAGE", "El draft no forma un RoomPackage válido", {
        issues: toReadableIssues(parsed.error),
      });
    }
    // Copia propia: nada de lo que se congela comparte referencias con el doc.
    return structuredClone(parsed.data);
  }

  async function packageAssets(
    actor: Actor,
    roomId: string,
    refs: readonly string[],
  ): Promise<PackagedAsset[]> {
    const packaged: PackagedAsset[] = [];
    for (const ref of refs) {
      const { bytes, contentType } = await assets.load(actor, ref);
      const digest = sha256(bytes);
      const key = publishedAssetKey(roomId, digest, contentType);
      await storage.put(key, bytes, contentType);
      packaged.push({ ref, key, sha256: digest, contentType, byteSize: bytes.byteLength });
    }
    return packaged;
  }

  /**
   * Comprobaciones previas comunes a `publish` y `checkPublishable` (con el
   * autor ya autorizado): estado → semver → serialización → `packageFormat` →
   * validador (❌ ⇒ `VALIDATION_FAILED` con el informe) → moderación de
   * assets. No escribe ni sube nada.
   */
  async function prepare(
    actor: Actor,
    room: PublishRoomRef,
    guard: PublishGuard = {},
    record = false,
  ) {
    const roomId = room.id;
    if (room.status === "removed") {
      throw new RoomPublishError(
        "ROOM_NOT_PUBLISHABLE",
        "La sala fue retirada por moderación; no se puede publicar",
      );
    }
    const blocker = deps.moderation ? await deps.moderation.publishBlocker(room.authorId) : null;
    if (blocker) {
      throw new RoomPublishError(blocker.code, blocker.message, {
        moderation: { until: blocker.until },
      });
    }
    const semvers = await store.listSemvers(roomId);
    checkLatestSemver(guard, semvers);

    const draftPackage = await serializeDraft(room);
    const packageHash = computePackageHash(draftPackage);
    if (guard.packageHash !== undefined && guard.packageHash !== packageHash) {
      throw new RoomPublishError(
        "DRAFT_CHANGED",
        "El draft ha cambiado desde que se aprobó la publicación: vuelve a solicitarla",
      );
    }
    // Clasifica el cambio de contenido frente a la última versión publicada
    // (ADR-035) para resolver el semver automáticamente. `checkPublishable`
    // (`record` falso: es una vista previa, la usa también `inspect` de la
    // confirmación humana de 4.5) no falla si no hay cambios — solo informa
    // que publicar ahora repetiría la última versión; el error explícito
    // `NOTHING_TO_PUBLISH` solo lo lanza la escritura real (`publish`,
    // `record` verdadero), tanto aquí como al recalcular dentro del lock.
    const previousVersion = await store.findLatestVersion(roomId);
    const change = classifyRoomPackageChange(previousVersion?.package ?? null, draftPackage);
    const resolvedSemver =
      !record && change === "none" ? (latestSemver(semvers) ?? "1.0.0") : nextSemver(semvers, change);

    const format = draftPackage.meta.packageFormat;
    if (!supportedFormats.includes(format)) {
      throw new RoomPublishError(
        "UNSUPPORTED_PACKAGE_FORMAT",
        `packageFormat "${format}" no soportado (se admite: ${supportedFormats.join(", ")})`,
      );
    }

    const assetManifest = await deps.loadAssetManifest?.(draftPackage);
    const report = validateRoomPackage(draftPackage, assetManifest ? { assetManifest } : {});
    if (!report.ok) {
      throw new RoomPublishError(
        "VALIDATION_FAILED",
        "La sala no pasa la validación: corrige los errores ❌ antes de publicar",
        { report, reportText: renderValidationReport(report) },
      );
    }

    // Smoke test del runtime (auditoría D-3): el validador ya comprueba
    // geometría y referencias, pero `toRuntimeModel` es la fuente de verdad de
    // lo que de verdad carga la partida; una publicación no debe poder dejar
    // el runtime sin poder construir el modelo.
    if (deps.runtimeModelCheck) {
      try {
        deps.runtimeModelCheck(draftPackage);
      } catch (error) {
        throw new RoomPublishError(
          "VALIDATION_FAILED",
          `El paquete no carga en el runtime: ${error instanceof Error ? error.message : String(error)}`,
          { report, reportText: renderValidationReport(report) },
        );
      }
    }

    const refs = collectAssetRefs(draftPackage);
    const problems = refs.length > 0 ? await assets.checkRefsForPublish(actor, refs) : [];
    if (problems.length > 0) {
      throw new RoomPublishError(
        "ASSETS_NOT_PUBLISHABLE",
        "Hay audios que no se pueden publicar (pendientes o rechazados en moderación)",
        { problems },
      );
    }

    // Pre-check de moderación (<2 s, specs/17 §3): después del validador, como
    // un paso más del pipeline. Solo `publish` deja rastro (`record`).
    const precheck = deps.moderation
      ? await deps.moderation.precheckPublish({
          roomId,
          authorId: room.authorId,
          pkg: draftPackage,
          contentHash: packageHash,
          record,
        })
      : null;
    if (precheck?.action === "block") {
      throw new RoomPublishError(
        "CONTENT_BLOCKED",
        "El pre-check de moderación ha bloqueado la publicación: revisa los textos señalados o apela el bloqueo",
        { moderation: { reportId: precheck.reportId, findings: precheck.findings } },
      );
    }
    return {
      precheck,
      draftPackage,
      packageHash,
      report,
      refs,
      latest: latestSemver(semvers),
      next: resolvedSemver,
    };
  }

  return {
    /**
     * `POST /api/rooms/:roomId/publish` — `{ semver?, changelog? }`. Orden:
     * autorización → serialización → `packageFormat` → validador (❌ bloquea,
     * `VALIDATION_FAILED` con el informe) → moderación de assets → subida al
     * bucket → `roomVersion` inmutable. Nada se sube si algo antes falla.
     *
     * `guard` (opcional, ticket 4.5): publica solo si el draft y la última
     * versión siguen siendo los aprobados (`DRAFT_CHANGED`/`VERSION_CHANGED`).
     */
    async publish(
      actor: Actor,
      roomId: string,
      input?: unknown,
      guard?: PublishGuard,
    ): Promise<PublishResult> {
      const room = await authorizeAuthor(actor, roomId);
      const { changelog } = parsePublishInput(input);
      const { draftPackage, report, refs, precheck } = await prepare(actor, room, guard, true);

      const packaged = await packageAssets(actor, room.id, refs);
      const assetsHash = computeAssetsHash({
        assetsManifest: draftPackage.meta.assetsManifest,
        assets: packaged,
      });

      const version = await store.withRoomLock(roomId, async (tx) => {
        const semvers = await tx.listSemvers(roomId);
        checkLatestSemver(guard, semvers);
        const previousVersion = await tx.findLatestVersion(roomId);
        const change = classifyRoomPackageChange(previousVersion?.package ?? null, draftPackage);
        const resolved = nextSemver(semvers, change);
        const frozen = rewriteAssetRefs(
          {
            ...draftPackage,
            meta: { ...draftPackage.meta, id: room.id, authorId: room.authorId, version: resolved },
          },
          new Map(packaged.map((a) => [a.ref, `r2://${a.key}`])),
        );
        const row = await tx.insertVersion({
          roomId: room.id,
          semver: resolved,
          package: frozen,
          assetsHash,
          changelog: changelog ?? null,
          publishedBy: actor.userId,
        });
        await tx.markPublished(room.id);
        return row;
      });

      if (deps.moderation && precheck?.action === "flag") {
        // 🟡 La versión ya está publicada: encolarla es un efecto secundario que
        // no debe convertir una publicación correcta en un error.
        await deps.moderation
          .recordPrecheckFlags({
            roomId: room.id,
            versionId: version.id,
            authorId: room.authorId,
            precheck,
          })
          .catch(() => null);
      }
      return {
        version: toMeta(version),
        report,
        assets: packaged,
        moderationFlags: precheck?.flags ?? [],
      };
    },

    /**
     * Las mismas comprobaciones que `publish` (autor, validador, moderación de
     * audios…) sin subir ni escribir nada: cómo quedaría la publicación y la
     * huella del draft que se aprobaría (ticket 4.5).
     */
    async checkPublishable(actor: Actor, roomId: string): Promise<PublishCheck> {
      const room = await authorizeAuthor(actor, roomId);
      const prepared = await prepare(actor, room);
      return {
        roomId: room.id,
        title: prepared.draftPackage.meta.title,
        defaultLanguage: prepared.draftPackage.meta.defaultLanguage,
        packageHash: prepared.packageHash,
        latestSemver: prepared.latest,
        nextSemver: prepared.next,
        report: prepared.report,
      };
    },

    /** `GET /api/rooms/:roomId/versions` — histórico público, de la más reciente a la más antigua. */
    async listVersions(actor: Actor, roomId: string): Promise<RoomVersionMeta[]> {
      const room = await findRoom(roomId);
      // Una sala retirada por moderación solo la ve su autor.
      if (room.status === "removed" && room.authorId !== actor.userId) {
        throw new RoomPublishError("NOT_FOUND", "Sala no encontrada");
      }
      return store.listVersions(room.id);
    },

    /**
     * `GET /api/rooms/:roomId/versions/:versionId/package` — el `RoomPackage`
     * congelado. Solo el autor o un admin de plataforma.
     */
    async getVersionPackage(
      actor: Actor,
      roomId: string,
      versionId: string,
    ): Promise<{ version: RoomVersionMeta; package: RoomPackage }> {
      requireUser(actor, RoomPublishError);
      const room = await findRoom(roomId);
      if (room.authorId !== actor.userId && !(await store.isAdmin(actor.userId))) {
        throw new RoomPublishError("FORBIDDEN", "Solo el autor puede leer el paquete de la sala");
      }
      const row = UUID_RE.test(versionId) ? await store.findVersion(room.id, versionId) : null;
      if (!row) throw new RoomPublishError("NOT_FOUND", "Versión no encontrada");
      return { version: toMeta(row), package: row.package };
    },
  };
}

export type RoomPublishService = ReturnType<typeof createRoomPublishService>;

// ── Implementaciones en memoria (tests y superficies sin infraestructura) ──

/**
 * Store en memoria con la semántica del de Prisma (lock por sala, `UNIQUE
 * (roomId, semver)`). Guarda y devuelve copias: lo publicado no se puede
 * mutar desde fuera.
 */
export function createInMemoryRoomPublishStore(
  rooms: PublishRoomRef[] = [],
  adminIds: Iterable<string> = [],
): RoomPublishStore & {
  addRoom(room: PublishRoomRef): void;
  rooms: Map<string, PublishRoomRef>;
} {
  const roomById = new Map(rooms.map((r) => [r.id, { ...r }]));
  const admins = new Set(adminIds);
  const versions: RoomVersionRow[] = [];
  const locks = new Map<string, Promise<unknown>>();
  let seq = 0;
  let clock = Date.UTC(2026, 0, 1);

  const clone = (row: RoomVersionRow): RoomVersionRow => structuredClone(row);

  const tx: RoomPublishTx = {
    async listSemvers(roomId) {
      return versions.filter((v) => v.roomId === roomId).map((v) => v.semver);
    },
    async findLatestVersion(roomId) {
      const matches = versions
        .filter((v) => v.roomId === roomId)
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
      return matches[0] ? clone(matches[0]) : null;
    },
    async insertVersion(input) {
      if (versions.some((v) => v.roomId === input.roomId && v.semver === input.semver)) {
        throw new Error(`UNIQUE (roomId, semver) violado: ${input.semver}`);
      }
      seq += 1;
      const row: RoomVersionRow = {
        ...structuredClone(input),
        id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
        publishedAt: new Date((clock += 1000)),
      };
      versions.push(row);
      return clone(row);
    },
    async markPublished(roomId) {
      const room = roomById.get(roomId);
      if (room?.status === "draft") room.status = "published";
    },
  };

  return {
    listSemvers: tx.listSemvers,
    findLatestVersion: tx.findLatestVersion,
    rooms: roomById,
    addRoom(room) {
      roomById.set(room.id, { ...room });
    },
    async isAdmin(userId) {
      return admins.has(userId);
    },
    async findRoom(roomId) {
      const room = roomById.get(roomId);
      return room ? { ...room } : null;
    },
    async listVersions(roomId) {
      return versions
        .filter((v) => v.roomId === roomId)
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
        .map(toMeta);
    },
    async findVersion(roomId, versionId) {
      const row = versions.find((v) => v.roomId === roomId && v.id === versionId);
      return row ? clone(row) : null;
    },
    async withRoomLock(roomId, fn) {
      const previous = locks.get(roomId) ?? Promise.resolve();
      const run = previous.then(
        () => fn(tx),
        () => fn(tx),
      );
      locks.set(
        roomId,
        run.catch(() => undefined),
      );
      return run;
    },
  };
}

/** Almacenamiento en memoria (fake del bucket en tests). */
export function createInMemoryPublishedAssetStorage(): PublishedAssetStorage & {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
} {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    async put(key, bytes, contentType) {
      objects.set(key, { bytes: bytes.slice(), contentType });
    },
  };
}

/**
 * Fuente de assets sobre el servicio de audio de 3.11: la moderación la decide
 * `checkRefsForPublish` (pendiente o rechazado ⇒ problema) y los bytes se leen
 * del bucket con la clave que resuelve `resolveAudioRef(…, "publish")`
 * (biblioteca incluida o subida propia aprobada).
 */
export function createAudioPublishAssetSource(deps: {
  audio: Pick<AudioAssetService, "checkRefsForPublish" | "resolveAudioRef">;
  readObject(key: string): Promise<{ bytes: Uint8Array; contentType: string }>;
}): PublishAssetSource {
  return {
    checkRefsForPublish: (actor, refs) => deps.audio.checkRefsForPublish(actor, refs),
    async load(actor, ref) {
      const resolved = await deps.audio.resolveAudioRef(actor, ref, "publish");
      return deps.readObject(resolved.storageKey);
    },
  };
}

/**
 * Fuente de assets para superficies sin servicio de audio cableado: cualquier
 * referencia se reporta como no publicable (conservador: nunca se publica un
 * audio sin pasar por moderación). Las salas sin audio publican igual.
 */
export function createUnavailablePublishAssetSource(): PublishAssetSource {
  return {
    async checkRefsForPublish(_actor, refs) {
      return [...new Set(refs)].map((ref) => ({
        ref,
        code: "ASSET_SOURCE_UNAVAILABLE",
        message: `No se puede comprobar la moderación de "${ref}" en este servidor`,
        rejectionReason: null,
      }));
    },
    async load(_actor, ref) {
      throw new Error(`Fuente de assets no disponible para "${ref}"`);
    },
  };
}
