import type { PrismaClient } from "../../generated/client";
import { quotePricing, type PricingSnapshot } from "./pricing-tiers";
import type { PurchaseConfirmationDetails, PurchaseConfirmationStore } from "./purchase-confirmation";

/**
 * Implementación Prisma del puerto de confirmación de compra. Relee la
 * `purchase` (`room`/`room_license`) o el `event` (`event_credits`) en el
 * momento del envío: si la compra ya no está `succeeded` (reintento tras un
 * reembolso, por ejemplo) o el evento ya no tiene el pago marcado, no se
 * envía nada.
 */
export function createPrismaPurchaseConfirmationStore(prisma: PrismaClient): PurchaseConfirmationStore {
  return {
    async findDetails(job): Promise<PurchaseConfirmationDetails | null> {
      if (job.kind === "event_credits") {
        const event = await prisma.event.findUnique({
          where: { id: job.eventId },
          select: {
            title: true,
            config: true,
            pricingSnapshot: true,
            playersPurchased: true,
            user: { select: { email: true, locale: true } },
          },
        });
        if (!event) return null;
        const config = event.config as { payment?: { status?: string } };
        if (config.payment?.status !== "paid") return null;
        const quote = quotePricing(event.pricingSnapshot as PricingSnapshot, event.playersPurchased);
        if (!quote) return null;
        return {
          email: event.user.email,
          locale: event.user.locale,
          itemTitle: event.title,
          amountCents: quote.totalCents,
          currency: quote.currency,
          players: event.playersPurchased,
        };
      }

      const purchase = await prisma.purchase.findFirst({
        where: { id: job.purchaseId, purchaseType: job.kind, status: "succeeded" },
        select: {
          amountCents: true,
          currency: true,
          user: { select: { email: true, locale: true } },
          roomVersion: {
            select: { room_roomVersion_roomIdToroom: { select: { title: true } } },
          },
        },
      });
      if (!purchase?.roomVersion) return null;
      return {
        email: purchase.user.email,
        locale: purchase.user.locale,
        itemTitle: purchase.roomVersion.room_roomVersion_roomIdToroom.title,
        amountCents: purchase.amountCents,
        currency: purchase.currency,
        players: null,
      };
    },
  };
}
