import type { PrismaClient } from "../../generated/client";
import type { RoomAccessStore } from "./room-access";

/** `RoomAccessStore` sobre Postgres (B-4). */
export function createPrismaRoomAccessStore(prisma: PrismaClient): RoomAccessStore {
  return {
    async findRoomPurchase(userId, roomId) {
      const row = await prisma.purchase.findFirst({
        where: { userId, purchaseType: "room", status: "succeeded", roomVersion: { roomId } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          roomVersionId: true,
          playSessionStartedAt: true,
          playSessionEndedAt: true,
          playSessionColyseusId: true,
        },
      });
      if (!row) return null;
      return {
        purchaseId: row.id,
        // `chkPurchaseTarget` garantiza `roomVersionId` en una compra `room`.
        roomVersionId: row.roomVersionId ?? "",
        playSessionStartedAt: row.playSessionStartedAt,
        playSessionEndedAt: row.playSessionEndedAt,
        playSessionColyseusId: row.playSessionColyseusId,
      };
    },
  };
}
