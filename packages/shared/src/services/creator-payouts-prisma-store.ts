import type { PrismaClient } from "../../generated/client";
import type { CreatorPayoutStore, PendingCreatorPayout } from "./creator-payouts";

/**
 * Implementación Prisma del puerto de payouts a creadores (B-9). Lee
 * directamente `purchase` (`room`/`room_license`, sin migración): las
 * columnas `creatorShareCents`/`stripeTransferId`/`stripePaymentIntentId` ya
 * existen desde `0007_purchases`.
 */
export function createPrismaCreatorPayoutStore(prisma: PrismaClient): CreatorPayoutStore {
  return {
    async findPendingPayouts(limit): Promise<PendingCreatorPayout[]> {
      const rows = await prisma.purchase.findMany({
        where: {
          purchaseType: { in: ["room", "room_license"] },
          status: "succeeded",
          stripeTransferId: null,
          creatorShareCents: { gt: 0 },
          roomVersionId: { not: null },
          stripePaymentIntentId: { not: null },
        },
        orderBy: { createdAt: "asc" },
        take: limit,
        select: {
          id: true,
          purchaseType: true,
          creatorShareCents: true,
          currency: true,
          stripePaymentIntentId: true,
          roomVersionId: true,
        },
      });
      return rows.map((row) => ({
        purchaseId: row.id,
        // El `where` ya garantiza `purchaseType IN ('room','room_license')`.
        purchaseType: row.purchaseType as "room" | "room_license",
        amountCents: row.creatorShareCents ?? 0,
        currency: row.currency,
        // El `where` ya garantiza `stripePaymentIntentId`/`roomVersionId` no nulos.
        paymentIntentId: row.stripePaymentIntentId ?? "",
        roomVersionId: row.roomVersionId ?? "",
      }));
    },
    async findCreatorAccountForVersion(roomVersionId) {
      const version = await prisma.roomVersion.findUnique({
        where: { id: roomVersionId },
        select: {
          room_roomVersion_roomIdToroom: { select: { user: { select: { stripeAccountId: true } } } },
        },
      });
      if (!version) return null;
      return { stripeAccountId: version.room_roomVersion_roomIdToroom.user.stripeAccountId };
    },
    async attachTransfer(purchaseId, transferId) {
      const { count } = await prisma.purchase.updateMany({
        where: { id: purchaseId, stripeTransferId: null },
        data: { stripeTransferId: transferId },
      });
      return count > 0;
    },
  };
}
