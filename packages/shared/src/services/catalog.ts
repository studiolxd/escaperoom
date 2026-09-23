import {
  isLanguageCode,
  type Difficulty,
  type RoomPackage,
  type RoomPackageMeta,
} from "../schemas";
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
 * Sala publicada tal y como la lista el catálogo (`GET /api/rooms`, specs/13
 * §3): metadata de la última versión publicada, nunca el `package` completo.
 */
export type CatalogRoom = {
  id: string;
  title: string;
  description: string;
  theme: string;
  difficulty: Difficulty;
  languages: string[];
  defaultLanguage: string;
  estimatedMinutes: number;
  players: { min: number; max: number };
  latestVersion: { id: string; semver: string; publishedAt: string };
};

/** Filtro del listado: la sala incluye TODOS los idiomas pedidos (`@>`). */
export type CatalogListFilter = { languages: string[] };

/**
 * Puerto de lectura del listado público. La implementación Prisma filtra en
 * Postgres (`package @> {"meta":{"languages":[...]}}` sobre el índice GIN de
 * `roomVersion.package`); la de memoria replica la misma semántica.
 */
export interface PublishedRoomListing {
  listPublished(filter: CatalogListFilter): Promise<CatalogRoom[]>;
}

export type CatalogErrorCode = "VALIDATION_ERROR";

/** Error de dominio del catálogo; los adaptadores lo traducen a HTTP/tRPC/MCP. */
export class CatalogError extends Error {
  readonly code: CatalogErrorCode;
  constructor(code: CatalogErrorCode, message: string) {
    super(message);
    this.name = "CatalogError";
    this.code = code;
  }
}

/** Mapea la `meta` de la última versión publicada a la fila del listado. */
export function toCatalogRoom(
  roomId: string,
  meta: RoomPackageMeta,
  version: { id: string; semver: string; publishedAt: Date },
): CatalogRoom {
  return {
    id: roomId,
    title: meta.title,
    description: meta.description,
    theme: meta.theme,
    difficulty: meta.difficulty,
    languages: [...meta.languages],
    defaultLanguage: meta.defaultLanguage,
    estimatedMinutes: meta.estimatedMinutes,
    players: { min: meta.players.min, max: meta.players.max },
    latestVersion: {
      id: version.id,
      semver: version.semver,
      publishedAt: version.publishedAt.toISOString(),
    },
  };
}

/** Máximo de idiomas por petición: el filtro es una intersección, no un buscador. */
export const MAX_LANGUAGE_FILTER = 10;

/**
 * Normaliza el filtro `language` (un código, varios, o una lista separada por
 * comas) y lo valida. Sin idiomas no se filtra.
 */
export function parseLanguageFilter(input: string | readonly string[] | undefined): string[] {
  const raw = input === undefined ? [] : typeof input === "string" ? [input] : [...input];
  const languages = [
    ...new Set(raw.flatMap((value) => value.split(",")).map((value) => value.trim())),
  ].filter((value) => value.length > 0);
  if (languages.length > MAX_LANGUAGE_FILTER) {
    throw new CatalogError("VALIDATION_ERROR", `Como mucho ${MAX_LANGUAGE_FILTER} idiomas`);
  }
  const invalid = languages.find((value) => !isLanguageCode(value));
  if (invalid !== undefined) {
    throw new CatalogError("VALIDATION_ERROR", `Código de idioma no válido: "${invalid}"`);
  }
  return languages;
}

/** Sin listado inyectado, el catálogo publicado es vacío (p. ej. el MCP de solo destacada). */
const EMPTY_LISTING: PublishedRoomListing = { listPublished: async () => [] };

/**
 * Servicio de catálogo. La lógica de dominio vive SOLO aquí; tRPC, REST y MCP
 * son adaptadores finos que lo invocan con un `actor`.
 */
export function createCatalogService(deps: {
  rooms: RoomPackageRepository;
  listing?: PublishedRoomListing;
}) {
  const listing = deps.listing ?? EMPTY_LISTING;
  return {
    /** Sala destacada del catálogo (lectura pública, también para invitados). */
    async getFeaturedRoom(actor: Actor): Promise<FeaturedRoom> {
      const roomPackage = await deps.rooms.load();
      return toFeaturedRoom(roomPackage, actor);
    },

    /**
     * Salas publicadas (lectura pública). `language` filtra por "la sala
     * incluye este idioma" (specs/08 §2.2); con varios, debe incluirlos todos.
     */
    async listRooms(
      _actor: Actor,
      input: { language?: string | readonly string[] } = {},
    ): Promise<{ rooms: CatalogRoom[] }> {
      const languages = parseLanguageFilter(input.language);
      return { rooms: await listing.listPublished({ languages }) };
    },
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
