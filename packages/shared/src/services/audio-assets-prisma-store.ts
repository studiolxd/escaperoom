import type { PrismaClient, audioAsset } from "../../generated/client";
import type { AudioAssetRow, AudioAssetStatus, AudioAssetStore } from "./audio-assets";

function toRow(row: audioAsset): AudioAssetRow {
  return { ...row, status: row.status as AudioAssetStatus };
}

/** Implementación Prisma de `audioAsset` (migración 0011). */
export function createPrismaAudioAssetStore(prisma: PrismaClient): AudioAssetStore {
  return {
    async canModerate(userId) {
      // Consultado en cada llamada: retirar el permiso tiene efecto inmediato.
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isModerator: true, isAdmin: true },
      });
      return user?.isModerator === true || user?.isAdmin === true;
    },
    async insertAsset(asset) {
      return toRow(await prisma.audioAsset.create({ data: asset }));
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
    async listByStatus(status, limit) {
      const rows = await prisma.audioAsset.findMany({
        where: { status },
        orderBy: { createdAt: "asc" },
        take: limit,
      });
      return rows.map(toRow);
    },
    async reviewIfPending(id, review) {
      // Actualización condicional: dos moderadores a la vez → solo uno gana.
      const { count } = await prisma.audioAsset.updateMany({
        where: { id, status: "pending" },
        data: review,
      });
      if (count === 0) return null;
      const row = await prisma.audioAsset.findUnique({ where: { id } });
      return row ? toRow(row) : null;
    },
  };
}
