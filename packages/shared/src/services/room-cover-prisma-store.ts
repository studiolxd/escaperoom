import type { PrismaClient } from "../../generated/client";
import type { RoomCoverRoomRef, RoomCoverStore } from "./room-cover";

/** Implementación Prisma del puerto de portada de sala sobre `room` (0005_rooms). */
export function createPrismaRoomCoverStore(prisma: PrismaClient): RoomCoverStore {
  return {
    async findRoom(roomId): Promise<RoomCoverRoomRef | null> {
      return prisma.room.findFirst({
        where: { id: roomId, deletedAt: null },
        select: { id: true, authorId: true, coverImageKey: true },
      });
    },
    async setCoverImageKey(roomId, key) {
      await prisma.room.update({ where: { id: roomId }, data: { coverImageKey: key } });
    },
  };
}
