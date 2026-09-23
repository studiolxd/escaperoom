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

/** Datos comerciales de la sala (columnas de `room`, specs/14 §5). */
export type CatalogCommerce = {
  /** `null` = sin precio individual fijado; el catálogo lo trata como gratis. */
  priceCents: number | null;
  currency: string;
  saleIndividual: boolean;
  saleEvents: boolean;
  licensePriceCents: number | null;
};

/** Clave de storage de la imagen de portada; `null` sin imagen subida (ticket UX). */
export type CatalogMedia = { coverImageKey: string | null };

/** Valoración agregada de las reseñas (`review`, specs/14 §9). */
export type RatingSummary = {
  /** Media redondeada a un decimal; `null` sin reseñas. */
  ratingAvg: number | null;
  ratingCount: number;
};

/**
 * Sala publicada tal y como la lista el catálogo (`GET /api/rooms`, specs/13
 * §3): metadata de la última versión publicada + datos comerciales + rating
 * agregado, nunca el `package` completo. Es también la forma del detalle
 * (`GET /api/rooms/:roomId`).
 */
export type CatalogRoom = CatalogCommerce &
  CatalogMedia &
  RatingSummary & {
    id: string;
    title: string;
    authorId: string;
    authorDisplayName: string;
    description: string;
    theme: string;
    difficulty: Difficulty;
    languages: string[];
    defaultLanguage: string;
    estimatedMinutes: number;
    players: { min: number; max: number };
    latestVersion: { id: string; semver: string; publishedAt: string };
  };

export const CATALOG_SORTS = ["recent", "rating", "price_asc", "price_desc"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

/**
 * Filtro ya validado del listado. Todos los criterios se combinan con AND:
 * - `languages`: la sala incluye TODOS los idiomas pedidos (`@>`);
 * - `difficulties`: la dificultad está entre las pedidas;
 * - `minPrice`/`maxPrice`: precio individual en céntimos (sin precio = 0);
 * - `players`: la sala admite ese nº de jugadores (`min ≤ n ≤ max`);
 * - `q`: el título contiene el texto (sin distinguir mayúsculas).
 */
export type CatalogListFilter = {
  languages: string[];
  difficulties: Difficulty[];
  minPrice: number | null;
  maxPrice: number | null;
  players: number | null;
  q: string | null;
  sort: CatalogSort;
};

/** Ventana de paginación que el servicio pide al puerto. */
export type CatalogPage = { offset: number; limit: number };

/**
 * Puerto de lectura del catálogo público. La implementación Prisma filtra y
 * ordena en Postgres (`package @> {"meta":{"languages":[...]}}` sobre el índice
 * GIN de `roomVersion.package`); la de memoria replica la misma semántica.
 */
export interface PublishedRoomListing {
  listPublished(filter: CatalogListFilter, page: CatalogPage): Promise<CatalogRoom[]>;
  /** Detalle de una sala `published` no borrada; `null` si no está en catálogo. */
  getPublished(roomId: string): Promise<CatalogRoom | null>;
}

export type CatalogErrorCode = "VALIDATION_ERROR" | "ROOM_NOT_FOUND";

/** Error de dominio del catálogo; los adaptadores lo traducen a HTTP/tRPC/MCP. */
export class CatalogError extends Error {
  readonly code: CatalogErrorCode;
  constructor(code: CatalogErrorCode, message: string) {
    super(message);
    this.name = "CatalogError";
    this.code = code;
  }
}

/** Media de valoraciones redondeada a un decimal (`null` sin reseñas). */
export function roundRating(avg: number | null | undefined, count: number): number | null {
  if (count === 0 || avg === null || avg === undefined) return null;
  return Math.round(avg * 10) / 10;
}

/** Mapea la `meta` de la última versión publicada (+ `room` y rating) a la fila del catálogo. */
export function toCatalogRoom(input: {
  roomId: string;
  meta: RoomPackageMeta;
  version: { id: string; semver: string; publishedAt: Date };
  authorId: string;
  authorDisplayName: string;
  commerce: CatalogCommerce;
  media?: CatalogMedia;
  rating: { avg: number | null; count: number };
}): CatalogRoom {
  const { roomId, meta, version, commerce, rating } = input;
  return {
    id: roomId,
    title: meta.title,
    authorId: input.authorId,
    authorDisplayName: input.authorDisplayName,
    description: meta.description,
    theme: meta.theme,
    difficulty: meta.difficulty,
    languages: [...meta.languages],
    defaultLanguage: meta.defaultLanguage,
    estimatedMinutes: meta.estimatedMinutes,
    players: { min: meta.players.min, max: meta.players.max },
    priceCents: commerce.priceCents,
    currency: commerce.currency.trim(),
    saleIndividual: commerce.saleIndividual,
    saleEvents: commerce.saleEvents,
    licensePriceCents: commerce.licensePriceCents,
    coverImageKey: input.media?.coverImageKey ?? null,
    ratingAvg: roundRating(rating.avg, rating.count),
    ratingCount: rating.count,
    latestVersion: {
      id: version.id,
      semver: version.semver,
      publishedAt: version.publishedAt.toISOString(),
    },
  };
}

/** Máximo de idiomas por petición: el filtro es una intersección, no un buscador. */
export const MAX_LANGUAGE_FILTER = 10;
export const CATALOG_DEFAULT_LIMIT = 20;
export const CATALOG_MAX_LIMIT = 50;
export const CATALOG_MAX_QUERY_LENGTH = 100;
/** Tope del filtro de jugadores (muy por encima de `maxPlayersPerRoom`). */
export const CATALOG_MAX_PLAYERS = 100;

type MultiValue = string | readonly string[] | undefined;

/** Un valor, varios repetidos o una lista separada por comas → lista sin duplicados. */
function splitMulti(input: MultiValue): string[] {
  const raw = input === undefined ? [] : typeof input === "string" ? [input] : [...input];
  return [...new Set(raw.flatMap((value) => value.split(",")).map((value) => value.trim()))].filter(
    (value) => value.length > 0,
  );
}

/**
 * Normaliza el filtro `language` (un código, varios, o una lista separada por
 * comas) y lo valida. Sin idiomas no se filtra.
 */
export function parseLanguageFilter(input: MultiValue): string[] {
  const languages = splitMulti(input);
  if (languages.length > MAX_LANGUAGE_FILTER) {
    throw new CatalogError("VALIDATION_ERROR", `Como mucho ${MAX_LANGUAGE_FILTER} idiomas`);
  }
  const invalid = languages.find((value) => !isLanguageCode(value));
  if (invalid !== undefined) {
    throw new CatalogError("VALIDATION_ERROR", `Código de idioma no válido: "${invalid}"`);
  }
  return languages;
}

function parseDifficulties(input: MultiValue | number | readonly number[]): Difficulty[] {
  const values =
    typeof input === "number"
      ? [String(input)]
      : Array.isArray(input)
        ? splitMulti(input.map(String))
        : splitMulti(input as MultiValue);
  const out: Difficulty[] = [];
  for (const value of values) {
    if (value !== "1" && value !== "2" && value !== "3") {
      throw new CatalogError("VALIDATION_ERROR", `Dificultad no válida: "${value}" (1, 2 o 3)`);
    }
    const difficulty = Number(value) as Difficulty;
    if (!out.includes(difficulty)) out.push(difficulty);
  }
  return out.sort();
}

/** Entero no negativo opcional (acepta string de query o número de tRPC). */
function parseIntParam(
  name: string,
  input: string | number | null | undefined,
  bounds: { min: number; max?: number },
): number | null {
  if (input === undefined || input === null || input === "") return null;
  const value = typeof input === "number" ? input : Number(input.trim());
  if (
    !Number.isInteger(value) ||
    value < bounds.min ||
    (bounds.max !== undefined && value > bounds.max)
  ) {
    const range =
      bounds.max === undefined ? `≥ ${bounds.min}` : `entre ${bounds.min} y ${bounds.max}`;
    throw new CatalogError("VALIDATION_ERROR", `"${name}" debe ser un entero ${range}`);
  }
  return value;
}

/** Cursor opaco de paginación (specs/13 §1): posición en el orden pedido. */
export function encodeCatalogCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64url");
}

export function decodeCatalogCursor(cursor: string | null | undefined): number {
  if (cursor === undefined || cursor === null || cursor === "") return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { o?: unknown };
    if (typeof parsed.o === "number" && Number.isInteger(parsed.o) && parsed.o >= 0)
      return parsed.o;
  } catch {
    // cae al error de abajo
  }
  throw new CatalogError("VALIDATION_ERROR", "Cursor de paginación no válido");
}

/** Entrada cruda del listado: tal cual llega de la query REST o de tRPC. */
export type CatalogListInput = {
  language?: MultiValue;
  difficulty?: MultiValue | number | readonly number[];
  minPrice?: string | number | null;
  maxPrice?: string | number | null;
  players?: string | number | null;
  q?: string | null;
  sort?: string | null;
  cursor?: string | null;
  limit?: string | number | null;
};

/** Valida y normaliza la entrada del listado; lanza `CatalogError` si algo no cuadra. */
export function parseCatalogQuery(input: CatalogListInput = {}): {
  filter: CatalogListFilter;
  offset: number;
  limit: number;
} {
  const minPrice = parseIntParam("minPrice", input.minPrice, { min: 0 });
  const maxPrice = parseIntParam("maxPrice", input.maxPrice, { min: 0 });
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    throw new CatalogError("VALIDATION_ERROR", '"minPrice" no puede ser mayor que "maxPrice"');
  }
  const q = input.q?.trim() ?? "";
  if (q.length > CATALOG_MAX_QUERY_LENGTH) {
    throw new CatalogError(
      "VALIDATION_ERROR",
      `La búsqueda admite como mucho ${CATALOG_MAX_QUERY_LENGTH} caracteres`,
    );
  }
  const sort =
    input.sort === undefined || input.sort === null || input.sort === "" ? "recent" : input.sort;
  if (!(CATALOG_SORTS as readonly string[]).includes(sort)) {
    throw new CatalogError("VALIDATION_ERROR", `Orden no válido: "${sort}"`);
  }
  return {
    filter: {
      languages: parseLanguageFilter(input.language),
      difficulties: parseDifficulties(input.difficulty),
      minPrice,
      maxPrice,
      players: parseIntParam("players", input.players, { min: 1, max: CATALOG_MAX_PLAYERS }),
      q: q.length > 0 ? q : null,
      sort: sort as CatalogSort,
    },
    offset: decodeCatalogCursor(input.cursor),
    limit:
      parseIntParam("limit", input.limit, { min: 1, max: CATALOG_MAX_LIMIT }) ??
      CATALOG_DEFAULT_LIMIT,
  };
}

/** Respuesta paginada del listado (specs/13 §1). */
export type CatalogListResult = { items: CatalogRoom[]; nextCursor: string | null };

/** Sin listado inyectado, el catálogo publicado es vacío (p. ej. el MCP de solo destacada). */
const EMPTY_LISTING: PublishedRoomListing = {
  listPublished: async () => [],
  getPublished: async () => null,
};

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
     * Salas publicadas (lectura pública), paginadas por cursor. Los filtros se
     * combinan; `language` exige que la sala incluya todos los idiomas pedidos
     * (specs/08 §2.2).
     */
    async listRooms(_actor: Actor, input: CatalogListInput = {}): Promise<CatalogListResult> {
      const { filter, offset, limit } = parseCatalogQuery(input);
      // Se pide una fila de más para saber si hay página siguiente sin contar.
      const rows = await listing.listPublished(filter, { offset, limit: limit + 1 });
      const items = rows.slice(0, limit);
      return {
        items,
        nextCursor: rows.length > limit ? encodeCatalogCursor(offset + limit) : null,
      };
    },

    /** Detalle público de una sala del catálogo (`GET /api/rooms/:roomId`). */
    async getRoom(_actor: Actor, roomId: string): Promise<CatalogRoom> {
      const room = await listing.getPublished(roomId);
      if (!room) throw new CatalogError("ROOM_NOT_FOUND", "La sala no existe o no está publicada");
      return room;
    },
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
