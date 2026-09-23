import type { Actor, CatalogService, RoomDraftService } from "@escaperoom/shared/services";
import type { BeforeDraftCommit, LiveDraftSync } from "./draft-writer";
import type { DraftSnapshotCache } from "./mutation-validation";
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
};
