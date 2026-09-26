import type { RoomPackage } from "@escaperoom/shared/schemas";
import type {
  Actor,
  AudioAssetService,
  CatalogService,
  PublishConfirmationService,
  RoomCoverService,
  RoomDraftService,
} from "@escaperoom/shared/services";
import type { AssetManifestInput } from "@escaperoom/shared/validator";
import type { BeforeDraftCommit, LiveDraftSync } from "./draft-writer";
import type { DraftSnapshotCache } from "./mutation-validation";
import type { PreviewPlaytestLauncher } from "./links";
import type { RoomDocToPackage } from "./room-draft-reader";

/** Regla de cuota: mismo shape que `RateLimitRule` de `packages/web/src/server/rate-limit.ts`. */
export type UploadQuotaRule = { limit: number; windowSeconds: number };

/**
 * Cuota de `upload` por usuario, una por `kind` (revisión de la PR #168,
 * D-12): la política vive en `RATE_LIMIT_POLICIES` de `packages/web` (que el
 * MCP no puede importar sin invertir la dependencia — web depende de
 * `mcp-server`, no al revés), así que solo el NÚMERO se inyecta; `upload` la
 * consume él mismo con `slidingRateLimiter` de `@escaperoom/kit/rate-limit`
 * (ya es dependencia del paquete, D-25) y la MISMA clave que usaría
 * `withRateLimit` en la ruta REST equivalente
 * (`${policyName}:user:${actor.userId}`) — así comparten cupo de verdad, no
 * dos contadores parecidos. El límite genérico de llamadas del MCP (4.7) no
 * basta por sí solo: es por token y pensado para tools baratas, no para una
 * que sube ficheros de hasta 10 MB.
 */
export type UploadQuotaPolicy = { policyName: string; user: UploadQuotaRule };

/**
 * Dependencias inyectables del MCP: los MISMOS servicios de dominio que usan
 * tRPC y REST (ADR-010/022) y el actor de la llamada como única diferencia.
 */
export type CreatorMcpDeps = {
  catalog: CatalogService;
  drafts: RoomDraftService;
  /** Actor de la conexión; `null` = sin identidad (las tools devuelven error de auth). */
  actor: Actor | null;
  /** Conversión doc Yjs → RoomPackage del ticket 3.1 (opcional hasta que se publique). */
  roomDocToPackage?: RoomDocToPackage;
  /**
   * Canal del editor en vivo (servidor del WebSocket de edición de 3.3 en el
   * mismo proceso). Sin él, las mutaciones se persisten con `drafts` y los
   * editores abiertos las reciben al reconectar.
   */
  liveSync?: LiveDraftSync;
  /** Enganche extra previo al commit, tras el validador incremental de 4.4 (tests, gates). */
  beforeCommit?: BeforeDraftCommit;
  /**
   * Caché de fotos del validador incremental (4.4). Por defecto, una compartida
   * por el proceso (el HTTP crea deps por petición).
   */
  snapshotCache?: DraftSnapshotCache;
  /**
   * Origen público de la web (p. ej. `https://escaperoom.app`): base de los
   * enlaces que devuelven `preview` y `publish` (4.5). Sin él, esas tools
   * responden `NOT_AVAILABLE`.
   */
  appUrl?: string;
  /** Playtest de 3.8 para `preview` (el `PlaytestLauncher` de web). */
  playtests?: PreviewPlaytestLauncher | null;
  /**
   * Solicitudes de publicación con confirmación humana (4.5). El MCP solo
   * PIDE publicar; la publicación la confirma el humano en la web.
   */
  publishRequests?: Pick<PublishConfirmationService, "request"> | null;
  /**
   * Tope, en bytes, del texto de una respuesta de tool (coste de tokens, 4.7).
   * Por defecto `DEFAULT_MAX_TOOL_RESPONSE_BYTES`; `Infinity` lo desactiva.
   */
  maxToolResponseBytes?: number;
  /**
   * Manifiesto del pack gráfico para el check `assets` del validador
   * (auditoría D-13): sin esto, la tool `validate` nunca comprobaba los
   * assets referenciados. `undefined` degrada el check a aviso, no bloquea.
   */
  loadAssetManifest?: (pkg: RoomPackage) => Promise<AssetManifestInput | undefined>;
  /**
   * Subida de portada de sala (meta-tool `upload`, D-12): el MISMO servicio
   * de dominio que `POST /api/rooms/:roomId/cover-image` (A-12) — comprueba
   * que el actor es el autor de la sala, sniffea los magic bytes y aplica el
   * mismo límite de tamaño. `undefined`/`null` → `upload` responde
   * `NOT_AVAILABLE` para `kind: "cover_image"` (p. ej. por stdio, sin bucket).
   */
  roomCover?: Pick<RoomCoverService, "uploadCoverImage"> | null;
  /**
   * Subida de audio a la biblioteca del creador (meta-tool `upload`, D-12): el
   * MISMO servicio que `POST /api/audio/uploads` (3.11) — tipo real, tamaño,
   * duración y pre-filtro de moderación antes de quedar `pending`.
   * `undefined`/`null` → `upload` responde `NOT_AVAILABLE` para `kind: "audio"`.
   */
  audio?: Pick<AudioAssetService, "uploadAudio"> | null;
  /**
   * Cuotas de `upload` por `kind` (revisión de la PR #168). `undefined`/`null`
   * (por `kind`, o el objeto entero) = sin cuota propia además del límite
   * genérico de llamadas del MCP — solo aceptable en tests o en un despliegue
   * sin `packages/web` delante (stdio de desarrollo).
   */
  uploadQuota?: {
    coverImage?: UploadQuotaPolicy | null;
    audio?: UploadQuotaPolicy | null;
  } | null;
};
