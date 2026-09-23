import type { Actor, CatalogService, RoomDraftService } from "@escaperoom/shared/services";
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
};
