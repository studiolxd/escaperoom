import type { PrismaClient } from "../../generated/client";
import { parseRoomPackage, type RoomPackage } from "../schemas";
import type { GameAccessStore } from "./game-access";

/**
 * `GameAccessStore` sobre Postgres (B-4): lo usa Colyseus para jugar una sala
 * comprada y reclamar la única partida de cada `purchase`.
 */
export function createPrismaGameAccessStore(prisma: PrismaClient): GameAccessStore {
  return {
    async loadRoomVersionPackage(roomVersionId): Promise<RoomPackage | null> {
      const version = await prisma.roomVersion.findUnique({
        where: { id: roomVersionId },
        select: { package: true },
      });
      return version ? parseRoomPackage(version.package) : null;
    },

    async claimPlaySession(purchaseId, colyseusRoomId): Promise<boolean> {
      const updated = await prisma.$executeRaw`
        UPDATE "purchase"
           SET "playSessionStartedAt" = now(),
               "playSessionColyseusId" = ${colyseusRoomId}
         WHERE id = ${purchaseId}::uuid
           AND "playSessionStartedAt" IS NULL`;
      return updated > 0;
    },
  };
}
