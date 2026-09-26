import { Prisma, type PrismaClient } from "../../generated/client/client";
import { createPrismaAdminDirectory } from "./admin-prisma-store";
import type { EventConfig, EventPurchaseRef, EventRow, EventStore, EventSummary, ExpiryRule } from "./events";
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

function toEventPurchase(row: {
  id: string;
  eventId: string | null;
  amountCents: number;
  currency: string;
  status: "pending" | "succeeded" | "failed" | "refunded";
}): EventPurchaseRef {
  return {
    id: row.id,
    // `chkPurchaseTarget` garantiza `eventId` en `event_credits`.
    eventId: row.eventId ?? "",
    amountCents: row.amountCents,
    currency: row.currency,
    status: row.status,
  };
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

/**
 * Implementación Prisma del puerto de eventos sobre `event` (specs/14 §6). La
 * tabla existe desde `0006_events`: el estado del pago y los flags de vídeo y
 * grabación viajan en `config` (JSONB). `version` (B-11, migración
 * `20260925120000_event_payment_integrity`) da concurrencia optimista sobre
 * esa escritura. La `purchase` `event_credits` que congela el importe del
 * checkout (B-1/B-8) reutiliza la tabla `purchase` de `0007_purchases`.
 */
export function createPrismaEventStore(prisma: PrismaClient): EventStore {
  return {
    ...createPrismaAdminDirectory(prisma),
    async findRoomVersion(roomVersionId) {
      const row = await prisma.roomVersion.findFirst({
        where: { id: roomVersionId, room_roomVersion_roomIdToroom: { deletedAt: null } },
        select: {
          id: true,
          package: true,
          room_roomVersion_roomIdToroom: {
            select: { id: true, authorId: true, status: true, saleEvents: true },
          },
        },
      });
      if (!row) return null;
      const room = row.room_roomVersion_roomIdToroom;
      // Solo lectura informativa (aviso de duración, ticket duración-salas):
      // el paquete ya se validó al publicar, así que no hace falta el coste
      // de `parseRoomPackage` completo aquí.
      const meta = (row.package as { meta?: { estimatedMinutes?: unknown } } | null)?.meta;
      const estimatedMinutes =
        typeof meta?.estimatedMinutes === "number" ? meta.estimatedMinutes : 0;
      return {
        roomVersionId: row.id,
        roomId: room.id,
        authorId: room.authorId,
        roomStatus: room.status,
        saleEvents: room.saleEvents,
        estimatedMinutes,
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
    async updateEvent(id, expected, patch) {
      const { config, expiryRules, ...scalars } = patch;
      const { count } = await prisma.event.updateMany({
        where: { id, status: expected.status, version: expected.version },
        data: {
          ...scalars,
          ...(config === undefined ? {} : { config: json(config) }),
          ...(expiryRules === undefined ? {} : { expiryRules: json(expiryRules) }),
          version: { increment: 1 },
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
    async insertEventPurchase(purchase) {
      await prisma.purchase.create({
        data: {
          id: purchase.id,
          userId: purchase.organizerId,
          purchaseType: "event_credits",
          eventId: purchase.eventId,
          amountCents: purchase.amountCents,
          currency: purchase.currency,
          status: "pending",
          stripePaymentIntentId: purchase.checkoutRef,
        },
      });
    },
    async findEventPurchase(purchaseId) {
      const row = await prisma.purchase.findFirst({
        where: { id: purchaseId, purchaseType: "event_credits" },
        select: { id: true, eventId: true, amountCents: true, currency: true, status: true },
      });
      return row ? toEventPurchase(row) : null;
    },
    async settleEventPurchase(purchaseId, paymentRef) {
      const { count } = await prisma.purchase.updateMany({
        where: { id: purchaseId, purchaseType: "event_credits", status: "pending" },
        data: { status: "succeeded", stripePaymentIntentId: paymentRef },
      });
      return count > 0;
    },
    async markEventPurchaseFailed(purchaseId) {
      await prisma.purchase.updateMany({
        where: { id: purchaseId, purchaseType: "event_credits", status: "pending" },
        data: { status: "failed" },
      });
    },
    async findEventPurchaseByPaymentRef(paymentRef) {
      const row = await prisma.purchase.findFirst({
        where: { purchaseType: "event_credits", stripePaymentIntentId: paymentRef },
        select: { id: true, eventId: true, amountCents: true, currency: true, status: true },
      });
      return row ? toEventPurchase(row) : null;
    },
    async markEventPurchaseRefunded(purchaseId) {
      const { count } = await prisma.purchase.updateMany({
        where: { id: purchaseId, purchaseType: "event_credits", status: "succeeded" },
        data: { status: "refunded" },
      });
      return count > 0;
    },
  };
}
