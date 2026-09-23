import type { Actor, CatalogService, RoomDraftService } from "@escaperoom/shared/services";
import type { BeforeDraftCommit, LiveDraftSync } from "./draft-writer";
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
  /** Enganche previo al commit de cada mutación (dry-run + validador de 4.4). */
  beforeCommit?: BeforeDraftCommit;
};
