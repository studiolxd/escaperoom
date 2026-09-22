import type { Difficulty, RoomPackage } from "../schemas";
import type { Actor, ActorRole } from "./actor";

/**
 * Proyección pública de una sala destacada: el subconjunto del `RoomPackage`
 * que necesitan catálogo, API pública y MCP. Es un DTO puro y serializable, de
 * modo que tRPC, REST y MCP devuelven exactamente la misma forma.
 */
export type FeaturedRoom = {
  id: string;
  title: string;
  description: string;
  theme: string;
  version: string;
  packageFormat: string;
  difficulty: Difficulty;
  languages: string[];
  defaultLanguage: string;
  estimatedMinutes: number;
  players: { min: number; max: number };
  counts: { rooms: number; puzzles: number };
  /** El actor que pidió la sala, para trazabilidad y permisos futuros. */
  viewer: { userId: string; organizationId: string | null; role: ActorRole };
};

/**
 * Puerto de lectura del catálogo. Los servicios dependen de esta interfaz, no
 * de Prisma ni del sistema de ficheros: la implementación se inyecta (ADR-022).
 */
export interface RoomPackageRepository {
  /** Devuelve el `RoomPackage` de la sala destacada, ya validado. */
  load(): Promise<RoomPackage>;
}

/** Mapea un `RoomPackage` validado al DTO público, con el `actor` embebido. */
export function toFeaturedRoom(roomPackage: RoomPackage, actor: Actor): FeaturedRoom {
  const { meta, map, puzzles } = roomPackage;
  return {
    id: meta.id,
    title: meta.title,
    description: meta.description,
    theme: meta.theme,
    version: meta.version,
    packageFormat: meta.packageFormat,
    difficulty: meta.difficulty,
    languages: [...meta.languages],
    defaultLanguage: meta.defaultLanguage,
    estimatedMinutes: meta.estimatedMinutes,
    players: { min: meta.players.min, max: meta.players.max },
    counts: { rooms: map.rooms.length, puzzles: puzzles.length },
    viewer: {
      userId: actor.userId,
      organizationId: actor.organizationId,
      role: actor.role,
    },
  };
}

/**
 * Servicio de catálogo. La lógica de dominio vive SOLO aquí; tRPC, REST y MCP
 * son adaptadores finos que lo invocan con un `actor`.
 */
export function createCatalogService(deps: { rooms: RoomPackageRepository }) {
  return {
    /** Sala destacada del catálogo (lectura pública, también para invitados). */
    async getFeaturedRoom(actor: Actor): Promise<FeaturedRoom> {
      const roomPackage = await deps.rooms.load();
      return toFeaturedRoom(roomPackage, actor);
    },
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
