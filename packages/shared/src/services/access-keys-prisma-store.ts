import { Prisma, type PrismaClient } from "../../generated/client";
import {
  OPEN_SESSION_STATUSES,
  type AccessKeyPatch,
  type AccessKeyRow,
  type AccessKeyStore,
  type GameSessionRef,
} from "./access-keys";
import { createPrismaEventStore } from "./events-prisma-store";

type DbAccessKey = Prisma.accessKeyGetPayload<object>;

function toRow(row: DbAccessKey): AccessKeyRow {
  return {
    code: row.code,
    eventId: row.eventId,
    sessionId: row.sessionId,
    groupId: row.groupId,
    email: row.email,
    keyType: row.keyType,
    status: row.status,
    singleUse: row.singleUse,
    requireConfirmation: row.requireConfirmation,
    regeneratedFrom: row.regeneratedFrom,
    seats: row.seats,
    redeemedCount: row.redeemedCount,
    sentAt: row.sentAt,
    confirmedAt: row.confirmedAt,
    activatedAt: row.activatedAt,
    usedAt: row.usedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

function toSession(row: {
  id: string;
  eventId: string;
  name: string;
  capacity: number;
  status: GameSessionRef["status"];
}): GameSessionRef {
  return {
    id: row.id,
    eventId: row.eventId,
    name: row.name,
    capacity: row.capacity,
    status: row.status,
  };
}

const sessionSelect = {
  id: true,
  eventId: true,
  name: true,
  capacity: true,
  status: true,
} as const;

/** Estados vivos en SQL (mismo conjunto que `LIVE_ACCESS_KEY_STATUSES`). */
const LIVE = Prisma.sql`('generated', 'sent', 'pending_confirmation', 'confirmed', 'active')`;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Solo los campos presentes del parche (Prisma trata `undefined` como "no tocar"). */
function patchData(patch: AccessKeyPatch): Prisma.accessKeyUncheckedUpdateManyInput {
  return { ...patch };
}

/**
 * Implementación Prisma del puerto de claves sobre `accessKey`, `gameSession` y
 * `group` (specs/14 §6 + `0012_access_keys`). El límite de asientos se comprueba
 * con la fila del evento bloqueada (`SELECT … FOR UPDATE`), así dos generaciones
 * simultáneas no superan `playersPurchased`. El aforo de una sesión en el canje
 * (5.8) se comprueba igual, con la fila de `gameSession` bloqueada.
 */
export function createPrismaAccessKeyStore(prisma: PrismaClient): AccessKeyStore {
  const events = createPrismaEventStore(prisma);

  return {
    findEvent: (id) => events.findEvent(id),

    async listSessions(eventId) {
      const rows = await prisma.gameSession.findMany({
        where: { eventId },
        orderBy: [{ createdAt: "asc" }, { name: "asc" }],
        select: sessionSelect,
      });
      return rows.map(toSession);
    },

    async insertSessions(eventId, sessions) {
      return prisma
        .$transaction(
          sessions.map((s) =>
            prisma.gameSession.create({
              data: { eventId, name: s.name, capacity: s.capacity },
              select: sessionSelect,
            }),
          ),
        )
        .then((rows) => rows.map(toSession));
    },

    async findGroup(groupId) {
      const row = await prisma.group.findUnique({
        where: { id: groupId },
        select: { id: true, sessionId: true, gameSession: { select: { eventId: true } } },
      });
      return row
        ? { id: row.id, sessionId: row.sessionId, eventId: row.gameSession.eventId }
        : null;
    },

    async codesInUse(codes) {
      const rows = await prisma.accessKey.findMany({
        where: { code: { in: codes } },
        select: { code: true },
      });
      return new Set(rows.map((r) => r.code));
    },

    async committedSeats(eventId) {
      const agg = await prisma.accessKey.aggregate({ where: { eventId }, _sum: { seats: true } });
      return agg._sum.seats ?? 0;
    },

    async insertKeys(eventId, seatLimit, rows) {
      try {
        return await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "event" WHERE id = ${eventId}::uuid FOR UPDATE`;
          const agg = await tx.accessKey.aggregate({ where: { eventId }, _sum: { seats: true } });
          const committed = agg._sum.seats ?? 0;
          const requested = rows.reduce((sum, r) => sum + r.seats, 0);
          if (committed + requested > seatLimit) {
            return { ok: false as const, reason: "SEAT_LIMIT" as const, committedSeats: committed };
          }
          await tx.accessKey.createMany({ data: rows });
          return { ok: true as const, keys: rows };
        });
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, reason: "CODE_COLLISION" };
        throw err;
      }
    },

    async findKey(code) {
      const row = await prisma.accessKey.findUnique({ where: { code } });
      return row ? toRow(row) : null;
    },

    async listKeys(eventId, { limit, after, status }) {
      const rows = await prisma.accessKey.findMany({
        where: {
          eventId,
          ...(status === null ? {} : { status }),
          ...(after === null
            ? {}
            : {
                OR: [
                  { createdAt: { gt: after.createdAt } },
                  { createdAt: after.createdAt, code: { gt: after.code } },
                ],
              }),
        },
        orderBy: [{ createdAt: "asc" }, { code: "asc" }],
        take: limit,
      });
      return rows.map(toRow);
    },

    async updateKey(code, expected, patch) {
      const { count } = await prisma.accessKey.updateMany({
        where: { code, status: expected.status, redeemedCount: expected.redeemedCount },
        data: patchData(patch),
      });
      if (count === 0) return null;
      const row = await prisma.accessKey.findUnique({ where: { code } });
      return row ? toRow(row) : null;
    },

    async rotateKey(code, expected, oldPatch, replacement) {
      try {
        return await prisma.$transaction(async (tx) => {
          const { count } = await tx.accessKey.updateMany({
            where: { code, status: expected.status, redeemedCount: expected.redeemedCount },
            data: patchData(oldPatch),
          });
          if (count === 0) return { ok: false as const, reason: "CONFLICT" as const };
          const row = await tx.accessKey.create({ data: replacement });
          return { ok: true as const, key: toRow(row) };
        });
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, reason: "CODE_COLLISION" };
        throw err;
      }
    },

    async listSessionSeats(eventId) {
      const [sessions, seats] = await Promise.all([
        prisma.gameSession.findMany({
          where: { eventId },
          orderBy: [{ createdAt: "asc" }, { name: "asc" }],
          select: sessionSelect,
        }),
        prisma.accessKey.groupBy({
          by: ["sessionId"],
          where: { eventId, sessionId: { not: null } },
          _sum: { redeemedCount: true },
        }),
      ]);
      const occupied = new Map(seats.map((r) => [r.sessionId, r._sum.redeemedCount ?? 0]));
      return sessions.map((s) => ({ ...toSession(s), occupied: occupied.get(s.id) ?? 0 }));
    },

    async listGroupSeats(sessionId) {
      const [groups, seats] = await Promise.all([
        prisma.group.findMany({
          where: { sessionId },
          orderBy: [{ createdAt: "asc" }, { name: "asc" }],
          select: { id: true, sessionId: true, name: true },
        }),
        prisma.accessKey.groupBy({
          by: ["groupId"],
          where: { sessionId, groupId: { not: null } },
          _sum: { redeemedCount: true },
        }),
      ]);
      const occupied = new Map(seats.map((r) => [r.groupId, r._sum.redeemedCount ?? 0]));
      return groups.map((g) => ({ ...g, occupied: occupied.get(g.id) ?? 0 }));
    },

    async redeemSeat(code, expected, patch, sessionId) {
      return prisma.$transaction(async (tx) => {
        const [session] = await tx.$queryRaw<Array<{ capacity: number; status: string }>>`
          SELECT capacity, status::text AS status FROM "gameSession"
           WHERE id = ${sessionId}::uuid FOR UPDATE`;
        if (!session || !(OPEN_SESSION_STATUSES as readonly string[]).includes(session.status)) {
          return { ok: false as const, reason: "SESSION_FULL" as const };
        }
        const agg = await tx.accessKey.aggregate({
          where: { sessionId },
          _sum: { redeemedCount: true },
        });
        if ((agg._sum.redeemedCount ?? 0) + 1 > session.capacity) {
          return { ok: false as const, reason: "SESSION_FULL" as const };
        }
        const { count } = await tx.accessKey.updateMany({
          where: { code, status: expected.status, redeemedCount: expected.redeemedCount },
          data: patchData(patch),
        });
        if (count === 0) return { ok: false as const, reason: "CONFLICT" as const };
        const row = await tx.accessKey.findUniqueOrThrow({ where: { code } });
        return { ok: true as const, key: toRow(row) };
      });
    },

    async expireByDeadline(now) {
      return prisma.$executeRaw`
        UPDATE "accessKey" SET status = 'expired'
         WHERE status IN ${LIVE}
           AND "expiresAt" IS NOT NULL
           AND "expiresAt" <= ${now}`;
    },

    async expireBySessionEnd() {
      return prisma.$executeRaw`
        UPDATE "accessKey" k SET status = 'expired'
          FROM "gameSession" s, "event" e
         WHERE k."sessionId" = s.id
           AND s.status = 'ended'
           AND e.id = k."eventId"
           AND e."expiryRules" @> '[{"type":"on_session_end"}]'::jsonb
           AND k.status IN ${LIVE}`;
    },

    async expireByGroupComplete() {
      return prisma.$executeRaw`
        UPDATE "accessKey" k SET status = 'expired'
          FROM "group" g, "event" e
         WHERE k."groupId" = g.id
           AND g."completedAt" IS NOT NULL
           AND e.id = k."eventId"
           AND e."expiryRules" @> '[{"type":"on_group_complete"}]'::jsonb
           AND k.status IN ${LIVE}`;
    },
  };
}
