import { logger } from "@escaperoom/kit/logger";
import { Prisma, type PrismaClient } from "../../generated/client";
import { includesAllLanguages, parseRoomPackage, RoomPackageMetaSchema } from "../schemas";
import {
  toCatalogRoom,
  type CatalogListFilter,
  type CatalogRoom,
  type CatalogSort,
  type PublishedRoomListing,
} from "./catalog";
import { isUuid } from "./common";

/** Estados de `room` (enum `roomStatus`); solo `published` aparece en el catálogo. */
export type CatalogRoomStatus = "draft" | "published" | "unlisted" | "archived" | "removed";

/** Una sala con sus versiones publicadas, como la guarda Postgres. */
export type InMemoryCatalogRoom = {
  roomId: string;
  status: CatalogRoomStatus;
  deleted?: boolean;
  authorId?: string;
  authorDisplayName?: string;
  priceCents?: number | null;
  currency?: string;
  saleIndividual?: boolean;
  saleEvents?: boolean;
  licensePriceCents?: number | null;
  coverImageKey?: string | null;
  versions: Array<{ id: string; semver: string; publishedAt: Date; package: unknown }>;
};

/** Fuente de valoraciones agregadas por sala (en memoria: el store de reseñas). */
export type RatingStatsSource = (roomId: string) => { avg: number | null; count: number };

const NO_RATINGS: RatingStatsSource = () => ({ avg: null, count: 0 });

/** Precio efectivo para filtrar y ordenar: sin precio individual cuenta como gratis. */
export function effectivePriceCents(room: Pick<CatalogRoom, "priceCents">): number {
  return room.priceCents ?? 0;
}

/** ¿Cumple la sala TODOS los criterios del filtro? (misma semántica que el SQL). */
export function matchesCatalogFilter(room: CatalogRoom, filter: CatalogListFilter): boolean {
  const price = effectivePriceCents(room);
  return (
    includesAllLanguages(room.languages, filter.languages) &&
    (filter.difficulties.length === 0 || filter.difficulties.includes(room.difficulty)) &&
    (filter.minPrice === null || price >= filter.minPrice) &&
    (filter.maxPrice === null || price <= filter.maxPrice) &&
    (filter.players === null ||
      (room.players.min <= filter.players && room.players.max >= filter.players)) &&
    (filter.q === null || room.title.toLocaleLowerCase().includes(filter.q.toLocaleLowerCase()))
  );
}

function byRecency(a: CatalogRoom, b: CatalogRoom): number {
  return (
    b.latestVersion.publishedAt.localeCompare(a.latestVersion.publishedAt) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Comparador del orden pedido; el desempate es siempre por publicación y luego id. */
export function compareCatalogRooms(sort: CatalogSort) {
  return (a: CatalogRoom, b: CatalogRoom): number => {
    switch (sort) {
      case "rating": {
        const ra = a.ratingAvg ?? -1;
        const rb = b.ratingAvg ?? -1;
        return rb - ra || b.ratingCount - a.ratingCount || byRecency(a, b);
      }
      case "price_asc":
        return effectivePriceCents(a) - effectivePriceCents(b) || byRecency(a, b);
      case "price_desc":
        return effectivePriceCents(b) - effectivePriceCents(a) || byRecency(a, b);
      default:
        return byRecency(a, b);
    }
  };
}

/**
 * Listado en memoria (tests y superficies sin base de datos). Replica la
 * consulta Prisma: última versión de cada sala `published` no borrada, filtros
 * sobre la `meta` de ESA versión y las columnas de `room`, rating agregado en
 * vivo desde `ratings` y el mismo orden con desempate estable.
 */
export function createInMemoryPublishedRoomListing(
  rooms: InMemoryCatalogRoom[],
  options: { ratings?: RatingStatsSource } = {},
): PublishedRoomListing {
  const ratings = options.ratings ?? NO_RATINGS;
  const catalogRows = () =>
    rooms
      .filter((room) => room.status === "published" && !room.deleted && room.versions.length > 0)
      .map((room) => {
        const latest = [...room.versions].sort(
          (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
        )[0];
        if (!latest) throw new Error("inalcanzable: la sala tiene versiones");
        return toCatalogRoom({
          roomId: room.roomId,
          meta: parseRoomPackage(latest.package).meta,
          version: latest,
          authorId: room.authorId ?? "author",
          authorDisplayName: room.authorDisplayName ?? "Autor",
          commerce: {
            priceCents: room.priceCents ?? null,
            currency: room.currency ?? "EUR",
            saleIndividual: room.saleIndividual ?? true,
            saleEvents: room.saleEvents ?? true,
            licensePriceCents: room.licensePriceCents ?? null,
          },
          media: { coverImageKey: room.coverImageKey ?? null },
          rating: ratings(room.roomId),
        });
      });
  return {
    async listPublished(filter, page) {
      return catalogRows()
        .filter((room) => matchesCatalogFilter(room, filter))
        .sort(compareCatalogRooms(filter.sort))
        .slice(page.offset, page.offset + page.limit);
    },
    async getPublished(roomId) {
      return catalogRows().find((room) => room.id === roomId) ?? null;
    },
    async countPublished(filter) {
      return catalogRows().filter((room) => matchesCatalogFilter(room, filter)).length;
    },
  };
}

type CatalogRow = {
  roomId: string;
  versionId: string;
  semver: string;
  publishedAt: Date;
  meta: unknown;
  priceCents: number | null;
  currency: string;
  saleIndividual: boolean;
  saleEvents: boolean;
  licensePriceCents: number | null;
  coverImageKey: string | null;
  authorId: string;
  authorName: string;
  ratingAvg: number | null;
  ratingCount: number;
};

/** Escapa `%`, `_` y `\` para usar el texto como literal dentro de `ILIKE`. */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const ORDER_BY: Record<CatalogSort, Prisma.Sql> = {
  recent: Prisma.sql`latest."publishedAt" DESC, latest."roomId"`,
  rating: Prisma.sql`ROUND(s.avg::numeric, 1) DESC NULLS LAST, COALESCE(s.count, 0) DESC,
                     latest."publishedAt" DESC, latest."roomId"`,
  price_asc: Prisma.sql`COALESCE(r."priceCents", 0) ASC, latest."publishedAt" DESC, latest."roomId"`,
  price_desc: Prisma.sql`COALESCE(r."priceCents", 0) DESC, latest."publishedAt" DESC, latest."roomId"`,
};

function whereClause(filter: CatalogListFilter): Prisma.Sql {
  const meta = Prisma.sql`latest.package -> 'meta'`;
  // `languages @> ARRAY[...]` como contención JSONB: usa el índice GIN
  // `jsonb_path_ops` (`ixRoomVersionPackage`); con la lista vacía casa todo.
  const conditions: Prisma.Sql[] = [
    Prisma.sql`latest.package @> ${JSON.stringify({ meta: { languages: filter.languages } })}::jsonb`,
  ];
  if (filter.difficulties.length > 0) {
    conditions.push(
      Prisma.sql`(${meta} ->> 'difficulty')::int IN (${Prisma.join(filter.difficulties)})`,
    );
  }
  if (filter.minPrice !== null) {
    conditions.push(Prisma.sql`COALESCE(r."priceCents", 0) >= ${filter.minPrice}`);
  }
  if (filter.maxPrice !== null) {
    conditions.push(Prisma.sql`COALESCE(r."priceCents", 0) <= ${filter.maxPrice}`);
  }
  if (filter.players !== null) {
    conditions.push(
      Prisma.sql`(${meta} -> 'players' ->> 'min')::int <= ${filter.players}
                 AND (${meta} -> 'players' ->> 'max')::int >= ${filter.players}`,
    );
  }
  if (filter.q !== null) {
    conditions.push(
      Prisma.sql`${meta} ->> 'title' ILIKE ${`%${escapeLikePattern(filter.q)}%`} ESCAPE '\\'`,
    );
  }
  return Prisma.join(conditions, " AND ");
}

/**
 * SELECT común a listado y detalle: última versión de cada sala `published`
 * no borrada (`DISTINCT ON`), columnas comerciales de `room`, nombre del autor
 * y rating agregado de `review`. `onlyRoomId` acota el detalle a una sala.
 */
function catalogSelect(onlyRoomId: string | null): Prisma.Sql {
  const roomScope = onlyRoomId === null ? Prisma.empty : Prisma.sql`AND r.id = ${onlyRoomId}::uuid`;
  return Prisma.sql`
    WITH latest AS (
      SELECT DISTINCT ON (v."roomId") v.id, v."roomId", v.semver, v."publishedAt", v.package
        FROM "roomVersion" v
        JOIN "room" r ON r.id = v."roomId"
       WHERE r.status = 'published' AND r."deletedAt" IS NULL ${roomScope}
       ORDER BY v."roomId", v."publishedAt" DESC
    ), s AS (
      -- rating en BD está en escala doblada (2-10, medios puntos): se divide
      -- entre 2 aquí para que avg salga ya en la escala 1-5 de la API.
      SELECT "roomId", (AVG(rating)::float8 / 2) AS avg, COUNT(*)::int AS count
        FROM "review"
       WHERE "roomId" IN (SELECT "roomId" FROM latest) AND "hiddenAt" IS NULL
       GROUP BY "roomId"
    )
    SELECT latest."roomId", latest.id AS "versionId", latest.semver, latest."publishedAt",
           latest.package -> 'meta' AS meta,
           r."priceCents", r.currency, r."saleIndividual", r."saleEvents", r."licensePriceCents",
           r."coverImageKey", r."authorId",
           u.name AS "authorName", s.avg AS "ratingAvg", COALESCE(s.count, 0) AS "ratingCount"
      FROM latest
      JOIN "room" r ON r.id = latest."roomId"
      JOIN "user" u ON u.id = r."authorId"
      LEFT JOIN s ON s."roomId" = latest."roomId"`;
}

function toRoom(row: CatalogRow): CatalogRoom | null {
  // Un paquete publicado ya pasó `validate`; si aun así su meta no casa con el
  // schema, se omite antes que romper el catálogo entero.
  const meta = RoomPackageMetaSchema.safeParse(row.meta);
  if (!meta.success) return null;
  return toCatalogRoom({
    roomId: row.roomId,
    meta: meta.data,
    version: { id: row.versionId, semver: row.semver, publishedAt: row.publishedAt },
    authorId: row.authorId,
    authorDisplayName: row.authorName,
    commerce: {
      priceCents: row.priceCents,
      currency: row.currency,
      saleIndividual: row.saleIndividual,
      saleEvents: row.saleEvents,
      licensePriceCents: row.licensePriceCents,
    },
    media: { coverImageKey: row.coverImageKey },
    rating: { avg: row.ratingAvg, count: Number(row.ratingCount) },
  });
}

/**
 * Implementación Prisma. Todos los filtros y el orden se resuelven en Postgres
 * sobre la ÚLTIMA versión de cada sala: una sala que retiró un idioma en su
 * versión actual deja de salir al filtrar por él. Sin columnas ni migraciones
 * nuevas: la metadata vive en `roomVersion.package -> 'meta'`.
 */
export function createPrismaPublishedRoomListing(prisma: PrismaClient): PublishedRoomListing {
  return {
    async listPublished(filter, page) {
      const rows = await prisma.$queryRaw<CatalogRow[]>`
        ${catalogSelect(null)}
         WHERE ${whereClause(filter)}
         ORDER BY ${ORDER_BY[filter.sort]}
        OFFSET ${page.offset} LIMIT ${page.limit}`;
      return rows.flatMap((row) => toRoom(row) ?? []);
    },
    async getPublished(roomId) {
      if (!isUuid(roomId)) return null;
      const rows = await prisma.$queryRaw<CatalogRow[]>`${catalogSelect(roomId)}`;
      const row = rows[0];
      return row ? toRoom(row) : null;
    },
    async countPublished(filter) {
      const rows = await prisma.$queryRaw<{ count: number }[]>`
        WITH latest AS (
          SELECT DISTINCT ON (v."roomId") v."roomId", v.package
            FROM "roomVersion" v
            JOIN "room" r ON r.id = v."roomId"
           WHERE r.status = 'published' AND r."deletedAt" IS NULL
           ORDER BY v."roomId", v."publishedAt" DESC
        )
        SELECT COUNT(*)::int AS count
          FROM latest
          JOIN "room" r ON r.id = latest."roomId"
         WHERE ${whereClause(filter)}`;
      return rows[0]?.count ?? 0;
    },
  };
}

/**
 * Store mínimo que necesita el cache (subconjunto de `ioredis`): así el
 * decorador no depende del cliente concreto y los tests pueden usar uno en
 * memoria. `set` recibe el TTL en segundos.
 */
export interface CatalogCacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<unknown>;
}

/** Un evento de acceso al cache, para medir aciertos y tiempos (decisión de 6.4). */
export type CatalogCacheTiming = {
  op: "listPublished" | "getPublished" | "countPublished";
  hit: boolean;
  ms: number;
};

export type CachedPublishedRoomListingOptions = {
  /** `null` cuando no hay `REDIS_URL` (dev sin Redis): el cache queda desactivado. */
  store: CatalogCacheStore | null;
  /** Prefijo de claves, compartido con rate-limit/colas (`redisPrefix()` de `@escaperoom/kit/redis`). */
  prefix: string;
  /** specs/03: mismo presupuesto de frescura que el `Cache-Control` de `GET /api/rooms` (60 s). */
  ttlSeconds?: number;
  onTiming?: (timing: CatalogCacheTiming) => void;
};

const DEFAULT_CATALOG_CACHE_TTL_SECONDS = 60;

/**
 * Cambia cuando el formato de lo cacheado varía de forma incompatible (aquí:
 * `ratingAvg` pasa a calcularse sobre la escala doblada de `review.rating`)
 * para que las claves antiguas, escritas por código previo al cambio,
 * simplemente dejen de leerse en vez de servir valores duplicados.
 */
const CATALOG_CACHE_VERSION = "v2";

/**
 * Serializa un valor con las claves de cada objeto ordenadas, para que el
 * mismo filtro dé siempre la misma clave de cache sin importar el orden en
 * que se construyó.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Cachea la CONSULTA del catálogo publicado en Redis (ticket 6.4), no la
 * respuesta HTTP: el render de `/[locale]/rooms` sigue siendo dinámico
 * (`connection()` en el layout, obligado por el nonce de la CSP — ticket 6.3),
 * pero no repite la consulta cara a Postgres en cada petición. Ver el porque en
 * `docs/reference/seguridad.md` §3 y ADR-027.
 *
 * Falla ABIERTO como el resto de usos de Redis en la app (rate limiting,
 * colas): un fallo de lectura o escritura en Redis nunca rompe el catálogo,
 * solo deja de acelerarlo.
 */
export function createCachedPublishedRoomListing(
  inner: PublishedRoomListing,
  options: CachedPublishedRoomListingOptions,
): PublishedRoomListing {
  const { store, prefix, ttlSeconds = DEFAULT_CATALOG_CACHE_TTL_SECONDS, onTiming } = options;
  if (!store) return inner;
  // Narrowing explícito: la función anidada de abajo cierra sobre `store`, y
  // TS no arrastra el `if (!store)` de arriba a través de un closure.
  const cacheStore: CatalogCacheStore = store;

  async function withCache<T>(
    op: CatalogCacheTiming["op"],
    keyPart: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const key = `${prefix}:catalog:${CATALOG_CACHE_VERSION}:${op}:${keyPart}`;
    const start = Date.now();
    try {
      const cached = await cacheStore.get(key);
      if (cached !== null) {
        onTiming?.({ op, hit: true, ms: Date.now() - start });
        return JSON.parse(cached) as T;
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err : new Error(String(err)), op },
        "catalog-cache: redis unavailable on read, falling back to postgres",
      );
    }

    const value = await load();
    onTiming?.({ op, hit: false, ms: Date.now() - start });
    void cacheStore.set(key, JSON.stringify(value), ttlSeconds).catch((err: unknown) => {
      logger.warn(
        { err: err instanceof Error ? err : new Error(String(err)), op },
        "catalog-cache: redis unavailable on write, skipping cache",
      );
    });
    return value;
  }

  return {
    listPublished: (filter, page) =>
      withCache("listPublished", stableStringify({ filter, page }), () =>
        inner.listPublished(filter, page),
      ),
    getPublished: (roomId) => withCache("getPublished", roomId, () => inner.getPublished(roomId)),
    countPublished: (filter) =>
      withCache("countPublished", stableStringify(filter), () => inner.countPublished(filter)),
  };
}
