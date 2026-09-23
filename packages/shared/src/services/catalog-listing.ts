import type { PrismaClient } from "../../generated/client";
import { includesAllLanguages, parseRoomPackage, RoomPackageMetaSchema } from "../schemas";
import { toCatalogRoom, type CatalogRoom, type PublishedRoomListing } from "./catalog";

/** Estados de `room` (enum `roomStatus`); solo `published` aparece en el catálogo. */
export type CatalogRoomStatus = "draft" | "published" | "unlisted" | "archived" | "removed";

/** Una sala con sus versiones publicadas, como la guarda Postgres. */
export type InMemoryCatalogRoom = {
  roomId: string;
  status: CatalogRoomStatus;
  deleted?: boolean;
  versions: Array<{ id: string; semver: string; publishedAt: Date; package: unknown }>;
};

function byPublishedAtDesc(a: CatalogRoom, b: CatalogRoom): number {
  return b.latestVersion.publishedAt.localeCompare(a.latestVersion.publishedAt);
}

/**
 * Listado en memoria (tests y superficies sin base de datos). Replica la
 * consulta Prisma: última versión de cada sala `published` no borrada, filtro
 * `languages @>` sobre la `meta` de ESA versión, orden por publicación.
 */
export function createInMemoryPublishedRoomListing(
  rooms: InMemoryCatalogRoom[],
): PublishedRoomListing {
  const published = rooms
    .filter((room) => room.status === "published" && !room.deleted && room.versions.length > 0)
    .map((room) => {
      const latest = [...room.versions].sort(
        (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
      )[0];
      if (!latest) throw new Error("inalcanzable: la sala tiene versiones");
      return toCatalogRoom(room.roomId, parseRoomPackage(latest.package).meta, latest);
    });
  return {
    async listPublished({ languages }) {
      return published
        .filter((room) => includesAllLanguages(room.languages, languages))
        .sort(byPublishedAtDesc);
    },
  };
}

type LatestVersionRow = {
  roomId: string;
  versionId: string;
  semver: string;
  publishedAt: Date;
  meta: unknown;
};

/**
 * Implementación Prisma. `languages @> ARRAY[...]` se expresa como contención
 * JSONB sobre `roomVersion.package` (`{"meta":{"languages":[...]}}`), que usa
 * el índice GIN `jsonb_path_ops` existente (`ixRoomVersionPackage`) sin añadir
 * columnas ni migraciones. El filtro se aplica a la ÚLTIMA versión de cada
 * sala: una sala que retiró un idioma en su versión actual deja de salir.
 */
export function createPrismaPublishedRoomListing(prisma: PrismaClient): PublishedRoomListing {
  return {
    async listPublished({ languages }) {
      const containment = JSON.stringify({ meta: { languages } });
      const rows = await prisma.$queryRaw<LatestVersionRow[]>`
        SELECT latest."roomId", latest.id AS "versionId", latest.semver,
               latest."publishedAt", latest.package -> 'meta' AS meta
          FROM (
            SELECT DISTINCT ON (v."roomId") v.id, v."roomId", v.semver, v."publishedAt", v.package
              FROM "roomVersion" v
              JOIN "room" r ON r.id = v."roomId"
             WHERE r.status = 'published' AND r."deletedAt" IS NULL
             ORDER BY v."roomId", v."publishedAt" DESC
          ) latest
         WHERE latest.package @> ${containment}::jsonb
         ORDER BY latest."publishedAt" DESC`;
      return rows.flatMap((row) => {
        // Un paquete publicado ya pasó `validate`; si aun así su meta no casa
        // con el schema, se omite antes que romper el catálogo entero.
        const meta = RoomPackageMetaSchema.safeParse(row.meta);
        if (!meta.success) return [];
        return [
          toCatalogRoom(row.roomId, meta.data, {
            id: row.versionId,
            semver: row.semver,
            publishedAt: row.publishedAt,
          }),
        ];
      });
    },
  };
}
