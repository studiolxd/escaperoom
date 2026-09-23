import type { Prisma, PrismaClient } from "../../generated/client";
import type { EventConfig, EventRow, EventStore, EventSummary, ExpiryRule } from "./events";
import type { PricingSnapshot } from "./pricing-tiers";

type DbEvent = Prisma.eventGetPayload<{ include: { roomVersion: { select: { roomId: true } } } }>;

const withRoom = { roomVersion: { select: { roomId: true } } } as const;

function toRow(row: DbEvent): EventRow {
  const { roomVersion, ...rest } = row;
  // Los JSONB se escriben siempre desde valores ya validados por el servicio.
  return {
    ...rest,
    roomId: roomVersion.roomId,
    config: row.config as unknown as EventConfig,
    expiryRules: row.expiryRules as unknown as ExpiryRule[],
    pricingSnapshot: row.pricingSnapshot as unknown as PricingSnapshot,
  };
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

/**
 * Implementación Prisma del puerto de eventos sobre `event` (specs/14 §6). La
 * tabla existe desde `0006_events`: el estado del pago y los flags de vídeo y
 * grabación viajan en `config` (JSONB), así que no hace falta migración.
 */
export function createPrismaEventStore(prisma: PrismaClient): EventStore {
  return {
    async isAdmin(userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true },
      });
      return user?.isAdmin === true;
    },
    async findRoomVersion(roomVersionId) {
      const row = await prisma.roomVersion.findFirst({
        where: { id: roomVersionId, room_roomVersion_roomIdToroom: { deletedAt: null } },
        select: {
          id: true,
          room_roomVersion_roomIdToroom: {
            select: { id: true, authorId: true, status: true, saleEvents: true },
          },
        },
      });
      if (!row) return null;
      const room = row.room_roomVersion_roomIdToroom;
      return {
        roomVersionId: row.id,
        roomId: room.id,
        authorId: room.authorId,
        roomStatus: room.status,
        saleEvents: room.saleEvents,
      };
    },
    async insertEvent(event) {
      const row = await prisma.event.create({
        data: {
          organizerId: event.organizerId,
          roomVersionId: event.roomVersionId,
          title: event.title,
          audience: event.audience,
          maxSimultaneousSessions: event.maxSimultaneousSessions,
          groupingMode: event.groupingMode,
          requireConfirmation: event.requireConfirmation,
          config: json(event.config),
          expiryRules: json(event.expiryRules),
          pricingSnapshot: json(event.pricingSnapshot),
          playersPurchased: event.playersPurchased,
          // Precisión de milisegundos (no la de `now()` en µs): el cursor de
          // `listByOrganizer` compara con un `Date` de JS.
          createdAt: new Date(),
        },
        include: withRoom,
      });
      return toRow(row);
    },
    async findEvent(id) {
      const row = await prisma.event.findUnique({ where: { id }, include: withRoom });
      return row ? toRow(row) : null;
    },
    async updateEvent(id, expectedStatus, patch) {
      const { config, expiryRules, ...scalars } = patch;
      const { count } = await prisma.event.updateMany({
        where: { id, status: expectedStatus },
        data: {
          ...scalars,
          ...(config === undefined ? {} : { config: json(config) }),
          ...(expiryRules === undefined ? {} : { expiryRules: json(expiryRules) }),
        },
      });
      if (count === 0) return null;
      const row = await prisma.event.findUnique({ where: { id }, include: withRoom });
      return row ? toRow(row) : null;
    },
    async listByOrganizer(organizerId, { limit, after }) {
      const rows = await prisma.event.findMany({
        where: {
          organizerId,
          ...(after === null
            ? {}
            : {
                OR: [
                  { createdAt: { lt: after.createdAt } },
                  { createdAt: after.createdAt, id: { lt: after.id } },
                ],
              }),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        include: withRoom,
      });
      return rows.map(toRow);
    },
    async summarize(eventId): Promise<EventSummary> {
      const [sessions, keys] = await Promise.all([
        prisma.gameSession.count({ where: { eventId } }),
        prisma.accessKey.groupBy({ by: ["status"], where: { eventId }, _count: { _all: true } }),
      ]);
      return {
        sessions,
        accessKeysByStatus: Object.fromEntries(keys.map((k) => [k.status, k._count._all])),
      };
    },
  };
}
