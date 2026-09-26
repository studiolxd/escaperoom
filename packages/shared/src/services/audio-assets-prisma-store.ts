import type { PrismaClient, audioAsset } from "../../generated/client/client";
import type { AudioAssetRow, AudioAssetSource, AudioAssetStatus, AudioAssetStore } from "./audio-assets";

function toRow(row: audioAsset): AudioAssetRow {
  return { ...row, status: row.status as AudioAssetStatus, source: row.source as AudioAssetSource };
}

/** Implementación Prisma de `audioAsset` (migraciones 0011 y 0017). */
export function createPrismaAudioAssetStore(prisma: PrismaClient): AudioAssetStore {
  return {
    async insertAsset(asset) {
      return toRow(
        await prisma.audioAsset.create({ data: { ...asset, source: asset.source ?? "upload" } }),
      );
    },
    async findAsset(id) {
      const row = await prisma.audioAsset.findUnique({ where: { id } });
      return row ? toRow(row) : null;
    },
    async listByOwner(ownerId) {
      const rows = await prisma.audioAsset.findMany({
        where: { ownerId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map(toRow);
    },
    async deleteAsset(id) {
      await prisma.audioAsset.deleteMany({ where: { id } });
    },
  };
}
