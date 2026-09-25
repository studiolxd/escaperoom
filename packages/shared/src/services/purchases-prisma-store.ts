import { Prisma, type PrismaClient } from "../../generated/client";
import { createPrismaAdminDirectory } from "./admin-prisma-store";
import type { PurchaseStore, RoomPurchaseRow } from "./purchases";

type DbPurchase = Prisma.purchaseGetPayload<object>;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function toPurchase(row: DbPurchase): RoomPurchaseRow {
  return {
    id: row.id,
    userId: row.userId,
    // `chkPurchaseTarget` garantiza `roomVersionId` en `room`.
    roomVersionId: row.roomVersionId ?? "",
    amountCents: row.amountCents,
    currency: row.currency,
    platformFeeCents: row.platformFeeCents,
    creatorShareCents: row.creatorShareCents,
    paymentRef: row.stripePaymentIntentId,
    transferRef: row.stripeTransferId,
    status: row.status,
    createdAt: row.createdAt,
  };
}

/**
 * Implementación Prisma del puerto de compras individuales. Las columnas
 * existen desde `0007_purchases` (`purchaseType: 'room'`): sin migración.
 */
export function createPrismaPurchaseStore(prisma: PrismaClient): PurchaseStore {
  return {
    ...createPrismaAdminDirectory(prisma),
    async findVersion(versionId) {
      const row = await prisma.roomVersion.findUnique({
        where: { id: versionId },
        select: { id: true, roomId: true },
      });
      return row;
    },
    async findRoom(roomId) {
      return prisma.room.findFirst({
        where: { id: roomId, deletedAt: null },
        select: {
          id: true,
          authorId: true,
          title: true,
          status: true,
          saleIndividual: true,
          priceCents: true,
          currency: true,
        },
      });
    },
    async findPurchase(id) {
      const row = await prisma.purchase.findFirst({ where: { id, purchaseType: "room" } });
      return row ? toPurchase(row) : null;
    },
    async findPurchaseByPaymentRef(paymentRef) {
      const row = await prisma.purchase.findFirst({
        where: { purchaseType: "room", stripePaymentIntentId: paymentRef },
      });
      return row ? toPurchase(row) : null;
    },
    async findOwnedPurchase(userId, roomVersionId) {
      const row = await prisma.purchase.findFirst({
        where: { userId, roomVersionId, purchaseType: "room", status: "succeeded" },
        orderBy: { createdAt: "asc" },
      });
      return row ? toPurchase(row) : null;
    },
    async insertPendingPurchase({ paymentRef, ...purchase }) {
      const row = await prisma.purchase.create({
        data: {
          ...purchase,
          purchaseType: "room",
          status: "pending",
          stripePaymentIntentId: paymentRef,
        },
      });
      return toPurchase(row);
    },
    async settlePurchase(purchaseId, payment) {
      try {
        const { count } = await prisma.purchase.updateMany({
          where: { id: purchaseId, purchaseType: "room", status: "pending" },
          data: {
            status: "succeeded",
            stripePaymentIntentId: payment.paymentRef,
            platformFeeCents: payment.platformFeeCents,
            creatorShareCents: payment.creatorShareCents,
          },
        });
        if (count === 0) return null;
      } catch (err) {
        // Confirmación duplicada concurrente contra `uxPurchaseStripePi`, o
        // (B-16) dos checkouts de la misma sala por el mismo usuario
        // liquidándose a la vez contra `uxPurchaseOwnedRoom`.
        if (isUniqueViolation(err)) return null;
        throw err;
      }
      const row = await prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
      return toPurchase(row);
    },
    async markFailed(purchaseId) {
      const { count } = await prisma.purchase.updateMany({
        where: { id: purchaseId, purchaseType: "room", status: "pending" },
        data: { status: "failed" },
      });
      if (count === 0) return null;
      const row = await prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
      return toPurchase(row);
    },
    async markRefundedByPaymentRef(paymentRef) {
      const { count } = await prisma.purchase.updateMany({
        where: { purchaseType: "room", status: "succeeded", stripePaymentIntentId: paymentRef },
        data: { status: "refunded" },
      });
      if (count === 0) return null;
      const row = await prisma.purchase.findFirstOrThrow({
        where: { purchaseType: "room", stripePaymentIntentId: paymentRef },
      });
      return toPurchase(row);
    },
  };
}
