import type {
  Actor,
  CatalogService,
  PublishConfirmationService,
  RoomDraftService,
} from "@escaperoom/shared/services";
import type { BeforeDraftCommit, LiveDraftSync } from "./draft-writer";
import type { DraftSnapshotCache } from "./mutation-validation";
import type { PreviewPlaytestLauncher } from "./links";
import type { RoomDocToPackage } from "./room-draft-reader";

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
};
