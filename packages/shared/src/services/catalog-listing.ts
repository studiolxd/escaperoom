import { Prisma, type PrismaClient } from "../../generated/client";
import { includesAllLanguages, parseRoomPackage, RoomPackageMetaSchema } from "../schemas";
import {
  toCatalogRoom,
  type CatalogListFilter,
  type CatalogRoom,
  type CatalogSort,
  type PublishedRoomListing,
} from "./catalog";

/** Estados de `room` (enum `roomStatus`); solo `published` aparece en el catálogo. */
export type CatalogRoomStatus = "draft" | "published" | "unlisted" | "archived" | "removed";

/** Una sala con sus versiones publicadas, como la guarda Postgres. */
export type InMemoryCatalogRoom = {
  roomId: string;
  status: CatalogRoomStatus;
  deleted?: boolean;
  authorDisplayName?: string;
  priceCents?: number | null;
  currency?: string;
  saleIndividual?: boolean;
  saleEvents?: boolean;
  licensePriceCents?: number | null;
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
          authorDisplayName: room.authorDisplayName ?? "Autor",
          commerce: {
            priceCents: room.priceCents ?? null,
            currency: room.currency ?? "EUR",
            saleIndividual: room.saleIndividual ?? true,
            saleEvents: room.saleEvents ?? true,
            licensePriceCents: room.licensePriceCents ?? null,
          },
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
  authorName: string;
  ratingAvg: number | null;
  ratingCount: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      SELECT "roomId", AVG(rating)::float8 AS avg, COUNT(*)::int AS count
        FROM "review"
       WHERE "roomId" IN (SELECT "roomId" FROM latest)
       GROUP BY "roomId"
    )
    SELECT latest."roomId", latest.id AS "versionId", latest.semver, latest."publishedAt",
           latest.package -> 'meta' AS meta,
           r."priceCents", r.currency, r."saleIndividual", r."saleEvents", r."licensePriceCents",
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
    authorDisplayName: row.authorName,
    commerce: {
      priceCents: row.priceCents,
      currency: row.currency,
      saleIndividual: row.saleIndividual,
      saleEvents: row.saleEvents,
      licensePriceCents: row.licensePriceCents,
    },
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
      if (!UUID_RE.test(roomId)) return null;
      const rows = await prisma.$queryRaw<CatalogRow[]>`${catalogSelect(roomId)}`;
      const row = rows[0];
      return row ? toRoom(row) : null;
    },
  };
}
