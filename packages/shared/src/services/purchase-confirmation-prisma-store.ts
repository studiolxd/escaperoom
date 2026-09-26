import { Prisma, type PrismaClient } from "../../generated/client/client";
import type { PurchaseConfirmationEmailJob } from "../mail";
import type {
  PendingConfirmations,
  PendingConfirmationsWindow,
  PurchaseConfirmationDetails,
  PurchaseConfirmationStore,
} from "./purchase-confirmation";

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
            playersPurchased: true,
            user: { select: { email: true, locale: true } },
          },
        });
        if (!event) return null;
        const config = event.config as { payment?: { status?: string } };
        if (config.payment?.status !== "paid") return null;
        // B-8: el importe cobrado es el CONGELADO en la `purchase`
        // `event_credits` `succeeded` de este evento (B-1), nunca el
        // recalculado desde `pricingSnapshot`/`playersPurchased` en el
        // momento del envío (que ya no tiene por qué coincidir).
        const purchase = await prisma.purchase.findFirst({
          where: { eventId: job.eventId, purchaseType: "event_credits", status: "succeeded" },
          select: { amountCents: true, currency: true },
        });
        if (!purchase) return null;
        return {
          email: event.user.email,
          locale: event.user.locale,
          itemTitle: event.title,
          amountCents: purchase.amountCents,
          currency: purchase.currency,
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

    async markConfirmationSent(job): Promise<void> {
      if (job.kind === "event_credits") {
        await prisma.event.update({
          where: { id: job.eventId },
          data: { confirmationSentAt: new Date() },
        });
        return;
      }
      await prisma.purchase.update({
        where: { id: job.purchaseId },
        data: { confirmationSentAt: new Date() },
      });
    },

    async findPendingConfirmations(window: PendingConfirmationsWindow): Promise<PendingConfirmations> {
      const { recentCutoff, abandonCutoff, abandonWindowStart, limit } = window;

      // `purchase` no tiene un instante de "cuándo pasó a succeeded" (solo
      // createdAt); es la mejor referencia disponible. `event` sí guarda
      // config.payment.paidAt (fecha real de pago) desde `markPaid()`; se usa
      // esa y solo se cae a createdAt si faltara en algún registro antiguo.
      const purchasePending = await prisma.$queryRaw<{ id: string; purchaseType: string }[]>`
        SELECT id, "purchaseType" FROM "purchase"
        WHERE "purchaseType" IN ('room', 'room_license')
          AND status = 'succeeded'
          AND "confirmationSentAt" IS NULL
          AND "createdAt" < ${recentCutoff}
          AND "createdAt" >= ${abandonCutoff}
        ORDER BY "createdAt" ASC
        LIMIT ${limit}
      `;
      const purchaseAbandoned = await prisma.$queryRaw<{ id: string; purchaseType: string }[]>`
        SELECT id, "purchaseType" FROM "purchase"
        WHERE "purchaseType" IN ('room', 'room_license')
          AND status = 'succeeded'
          AND "confirmationSentAt" IS NULL
          AND "createdAt" < ${abandonCutoff}
          AND "createdAt" >= ${abandonWindowStart}
        ORDER BY "createdAt" ASC
        LIMIT ${limit}
      `;
      const eventPaidAtExpr = Prisma.sql`COALESCE((config -> 'payment' ->> 'paidAt')::timestamptz, "createdAt")`;
      const eventPending = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "event"
        WHERE (config -> 'payment' ->> 'status') = 'paid'
          AND "confirmationSentAt" IS NULL
          AND ${eventPaidAtExpr} < ${recentCutoff}
          AND ${eventPaidAtExpr} >= ${abandonCutoff}
        ORDER BY ${eventPaidAtExpr} ASC
        LIMIT ${limit}
      `;
      const eventAbandoned = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "event"
        WHERE (config -> 'payment' ->> 'status') = 'paid'
          AND "confirmationSentAt" IS NULL
          AND ${eventPaidAtExpr} < ${abandonCutoff}
          AND ${eventPaidAtExpr} >= ${abandonWindowStart}
        ORDER BY ${eventPaidAtExpr} ASC
        LIMIT ${limit}
      `;

      const toJobs = (
        purchases: { id: string; purchaseType: string }[],
        events: { id: string }[],
      ): PurchaseConfirmationEmailJob[] => [
        ...purchases.map(
          (p): PurchaseConfirmationEmailJob => ({
            kind: p.purchaseType as "room" | "room_license",
            purchaseId: p.id,
          }),
        ),
        ...events.map((e): PurchaseConfirmationEmailJob => ({ kind: "event_credits", eventId: e.id })),
      ];

      return {
        pending: toJobs(purchasePending, eventPending),
        abandoned: toJobs(purchaseAbandoned, eventAbandoned),
      };
    },
  };
}
