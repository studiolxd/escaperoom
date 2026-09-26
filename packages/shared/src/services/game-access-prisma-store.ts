import type { PrismaClient } from "../../generated/client/client";
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
      // Remate de #140: un `gameToken` sigue vigente (no caduca hasta 15 min
      // tras emitirse) aunque la compra se reembolse justo después. Sin este
      // filtro, esa compra reembolsada todavía podía reclamar y arrancar una
      // partida con la misma `purchaseId`.
      //
      // Ticket duración-salas: "en curso pero caducada" se decide por el
      // último latido (`playSessionHeartbeatAt`), no por cuándo empezó — con
      // duración de sala sin tope, una partida legítima de varias horas no
      // puede considerarse abandonada solo por su antigüedad.
      const updated = await prisma.$executeRaw`
        UPDATE "purchase"
           SET "playSessionStartedAt" = now(),
               "playSessionHeartbeatAt" = NULL,
               "playSessionColyseusId" = ${colyseusRoomId}
         WHERE id = ${purchaseId}::uuid
           AND status = 'succeeded'
           AND "playSessionEndedAt" IS NULL
           AND (
             "playSessionStartedAt" IS NULL
             OR COALESCE("playSessionHeartbeatAt", "playSessionStartedAt")
                < now() - (${PLAY_SESSION_STALE_AFTER_SECONDS} * interval '1 second')
           )`;
      return updated > 0;
    },

    async heartbeatPlaySession(purchaseId, colyseusRoomId): Promise<void> {
      await prisma.$executeRaw`
        UPDATE "purchase"
           SET "playSessionHeartbeatAt" = now()
         WHERE id = ${purchaseId}::uuid
           AND "playSessionEndedAt" IS NULL
           AND "playSessionColyseusId" = ${colyseusRoomId}`;
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
               "playSessionHeartbeatAt" = NULL,
               "playSessionColyseusId" = NULL
         WHERE id = ${purchaseId}::uuid
           AND "playSessionEndedAt" IS NULL
           AND "playSessionColyseusId" = ${colyseusRoomId}`;
    },
  };
}
