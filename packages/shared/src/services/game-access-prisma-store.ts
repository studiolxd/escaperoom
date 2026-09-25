import type { PrismaClient } from "../../generated/client";
import { parseRoomPackage, type RoomPackage } from "../schemas";
import { PLAY_SESSION_STALE_AFTER_SECONDS, type GameAccessStore } from "./game-access";

/**
 * `GameAccessStore` sobre Postgres (B-4): lo usa Colyseus para jugar una sala
 * comprada y reclamar/consumir/liberar la partida de cada `purchase`.
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
           AND "playSessionEndedAt" IS NULL
           AND (
             "playSessionStartedAt" IS NULL
             OR "playSessionStartedAt" < now() - (${PLAY_SESSION_STALE_AFTER_SECONDS} * interval '1 second')
           )`;
      return updated > 0;
    },

    async markPlaySessionEnded(purchaseId): Promise<void> {
      await prisma.$executeRaw`
        UPDATE "purchase"
           SET "playSessionEndedAt" = now()
         WHERE id = ${purchaseId}::uuid
           AND "playSessionEndedAt" IS NULL`;
    },

    async releasePlaySession(purchaseId, colyseusRoomId): Promise<void> {
      await prisma.$executeRaw`
        UPDATE "purchase"
           SET "playSessionStartedAt" = NULL,
               "playSessionColyseusId" = NULL
         WHERE id = ${purchaseId}::uuid
           AND "playSessionEndedAt" IS NULL
           AND "playSessionColyseusId" = ${colyseusRoomId}`;
    },
  };
}
