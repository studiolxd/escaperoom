import type { PrismaClient } from "../../generated/client/client";
import type { StripeWebhookEventPurgeStore } from "./stripe-webhook-purge";

/** `receivedAt < cutoff` (B-19); sin condición de idempotencia que comprobar: es un borrado simple. */
export function createPrismaStripeWebhookEventPurgeStore(
  prisma: PrismaClient,
): StripeWebhookEventPurgeStore {
  return {
    async deleteExpired(cutoff) {
      const { count } = await prisma.stripeWebhookEvent.deleteMany({
        where: { receivedAt: { lt: cutoff } },
      });
      return count;
    },
  };
}
