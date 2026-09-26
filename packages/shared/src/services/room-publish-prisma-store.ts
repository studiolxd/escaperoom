import type { Prisma, PrismaClient } from "../../generated/client/client";
import { createPrismaAdminDirectory } from "./admin-prisma-store";
import type { RoomPackage } from "../schemas";
import type {
  RoomPublishStore,
  RoomPublishTx,
  RoomVersionMeta,
  RoomVersionRow,
} from "./room-publish";

type Db = PrismaClient | Prisma.TransactionClient;

type VersionRow = {
  id: string;
  roomId: string;
  semver: string;
  package: Prisma.JsonValue;
  assetsHash: string;
  changelog: string | null;
  publishedBy: string;
  publishedAt: Date;
};

function toRow(row: VersionRow): RoomVersionRow {
  // El JSONB se escribió desde un `RoomPackage` ya validado y no se reescribe.
  return { ...row, package: row.package as unknown as RoomPackage };
}

function listSemvers(db: Db) {
  return async (roomId: string): Promise<string[]> => {
    const rows = await db.roomVersion.findMany({ where: { roomId }, select: { semver: true } });
    return rows.map((r) => r.semver);
  };
}

function findLatestVersion(db: Db) {
  return async (roomId: string): Promise<RoomVersionRow | null> => {
    const row = await db.roomVersion.findFirst({
      where: { roomId },
      orderBy: { publishedAt: "desc" },
    });
    return row ? toRow(row) : null;
  };
}

function txOps(db: Db): RoomPublishTx {
  return {
    listSemvers: listSemvers(db),
    findLatestVersion: findLatestVersion(db),
    async insertVersion(version) {
      const row = await db.roomVersion.create({
        data: {
          roomId: version.roomId,
          semver: version.semver,
          package: version.package as unknown as Prisma.InputJsonValue,
          assetsHash: version.assetsHash,
          changelog: version.changelog,
          publishedBy: version.publishedBy,
        },
      });
      return toRow(row);
    },
    async markPublished(roomId) {
      await db.room.updateMany({
        where: { id: roomId, status: "draft" },
        data: { status: "published", updatedAt: new Date() },
      });
    },
  };
}

/**
 * Implementación Prisma del puerto de publicación sobre `roomVersion` (specs/14
 * §5). La tabla ya existe desde `0005_rooms`: `packageFormat` viaja dentro del
 * JSONB (`package->'meta'->>'packageFormat'`), así que no hace falta migración.
 */
export function createPrismaRoomPublishStore(prisma: PrismaClient): RoomPublishStore {
  return {
    listSemvers: listSemvers(prisma),
    findLatestVersion: findLatestVersion(prisma),
    ...createPrismaAdminDirectory(prisma),
    findRoom(roomId) {
      return prisma.room.findFirst({
        where: { id: roomId, deletedAt: null },
        select: { id: true, authorId: true, status: true },
      });
    },
    async listVersions(roomId): Promise<RoomVersionMeta[]> {
      return prisma.$queryRaw<RoomVersionMeta[]>`
        SELECT id, semver, changelog, "assetsHash", "publishedAt",
               package->'meta'->>'packageFormat' AS "packageFormat"
          FROM "roomVersion"
         WHERE "roomId" = ${roomId}::uuid
         ORDER BY "publishedAt" DESC, id DESC`;
    },
    async findVersion(roomId, versionId) {
      const row = await prisma.roomVersion.findFirst({ where: { id: versionId, roomId } });
      return row ? toRow(row) : null;
    },
    withRoomLock(roomId, fn) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "room" WHERE id = ${roomId}::uuid FOR UPDATE`;
        return fn(txOps(tx));
      });
    },
  };
}
