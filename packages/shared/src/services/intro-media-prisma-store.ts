import type { PrismaClient, introMediaAsset } from "../../generated/client/client";
import type {
  IntroMediaAssetRow,
  IntroMediaKind,
  IntroMediaStatus,
  IntroMediaStore,
} from "./intro-media";

function toRow(row: introMediaAsset): IntroMediaAssetRow {
  return { ...row, kind: row.kind as IntroMediaKind, status: row.status as IntroMediaStatus };
}

/** Implementación Prisma de `introMediaAsset` (migración 20260926160000_intro_media_asset). */
export function createPrismaIntroMediaStore(prisma: PrismaClient): IntroMediaStore {
  return {
    async findRoom(roomId) {
      return prisma.room.findFirst({
        where: { id: roomId, deletedAt: null },
        select: { id: true, authorId: true },
      });
    },
    async insertAsset(asset) {
      return toRow(await prisma.introMediaAsset.create({ data: asset }));
    },
    async findAsset(id) {
      const row = await prisma.introMediaAsset.findUnique({ where: { id } });
      return row ? toRow(row) : null;
    },
    async markReady(id, byteSize) {
      return toRow(
        await prisma.introMediaAsset.update({
          where: { id },
          data: { status: "ready", byteSize, updatedAt: new Date() },
        }),
      );
    },
    async deleteAsset(id) {
      await prisma.introMediaAsset.deleteMany({ where: { id } });
    },
  };
}
