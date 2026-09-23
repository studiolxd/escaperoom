import type { Prisma, PrismaClient } from "../../generated/client";
import type {
  DraftSnapshot,
  DraftSnapshotMeta,
  DraftUpdate,
  RoomDraftStore,
  RoomDraftTx,
} from "./room-draft";

type Db = PrismaClient | Prisma.TransactionClient;

type SnapshotRow = {
  id: bigint;
  roomId: string;
  state: Uint8Array;
  updatesAppliedThrough: bigint;
  createdAt: Date;
};

type UpdateRow = {
  id: bigint;
  roomId: string;
  updateData: Uint8Array;
  authorId: string | null;
  createdAt: Date;
};

function toSnapshot(row: SnapshotRow): DraftSnapshot {
  return {
    id: row.id,
    roomId: row.roomId,
    state: new Uint8Array(row.state),
    updatesAppliedThrough: row.updatesAppliedThrough,
    createdAt: row.createdAt,
  };
}

function toUpdate(row: UpdateRow): DraftUpdate {
  return {
    id: row.id,
    roomId: row.roomId,
    data: new Uint8Array(row.updateData),
    authorId: row.authorId,
    createdAt: row.createdAt,
  };
}

function txOps(db: Db): RoomDraftTx {
  return {
    async latestSnapshot(roomId, atOrBeforeUpdateId) {
      const row = await db.roomSnapshot.findFirst({
        where: {
          roomId,
          ...(atOrBeforeUpdateId === undefined
            ? {}
            : { updatesAppliedThrough: { lte: atOrBeforeUpdateId } }),
        },
        orderBy: { id: "desc" },
      });
      return row ? toSnapshot(row) : null;
    },
    async updatesAfter(roomId, afterId, throughId) {
      const rows = await db.roomUpdate.findMany({
        where: {
          roomId,
          id: throughId === undefined ? { gt: afterId } : { gt: afterId, lte: throughId },
        },
        orderBy: { id: "asc" },
      });
      return rows.map(toUpdate);
    },
    countUpdatesAfter(roomId, afterId) {
      return db.roomUpdate.count({ where: { roomId, id: { gt: afterId } } });
    },
    async insertUpdate(roomId, data, authorId) {
      const row = await db.roomUpdate.create({
        data: { roomId, updateData: Buffer.from(data), authorId },
      });
      return toUpdate(row);
    },
    async insertSnapshot(roomId, state, updatesAppliedThrough) {
      const row = await db.roomSnapshot.create({
        data: { roomId, state: Buffer.from(state), updatesAppliedThrough },
      });
      return toSnapshot(row);
    },
  };
}

/**
 * Implementación Prisma del puerto del draft sobre `roomUpdate`/`roomSnapshot`
 * (specs/14 §5). El lock por sala es un `SELECT … FOR UPDATE` sobre la fila de
 * `room` dentro de la transacción: serializa appends y compactaciones de la
 * misma sala sin bloquear las demás.
 */
export function createPrismaRoomDraftStore(prisma: PrismaClient): RoomDraftStore {
  return {
    ...txOps(prisma),
    async findRoom(roomId) {
      const room = await prisma.room.findFirst({
        where: { id: roomId, deletedAt: null },
        select: { id: true, authorId: true },
      });
      return room ?? null;
    },
    findSnapshot(roomId, snapshotId) {
      return prisma.roomSnapshot.findFirst({
        where: { id: snapshotId, roomId },
        select: { id: true, roomId: true, updatesAppliedThrough: true, createdAt: true },
      });
    },
    async listSnapshots(roomId, limit): Promise<DraftSnapshotMeta[]> {
      const rows = await prisma.$queryRaw<
        Array<Omit<SnapshotRow, "state"> & { byteSize: number }>
      >`SELECT id, "roomId", "updatesAppliedThrough", "createdAt",
               octet_length(state)::int AS "byteSize"
          FROM "roomSnapshot"
         WHERE "roomId" = ${roomId}::uuid
         ORDER BY id DESC
         LIMIT ${limit}`;
      return rows.map((r) => ({
        id: r.id,
        roomId: r.roomId,
        updatesAppliedThrough: r.updatesAppliedThrough,
        createdAt: r.createdAt,
        byteSize: r.byteSize,
      }));
    },
    withRoomLock(roomId, fn) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "room" WHERE id = ${roomId}::uuid FOR UPDATE`;
        return fn(txOps(tx));
      });
    },
  };
}
