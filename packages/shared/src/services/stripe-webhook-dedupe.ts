import { Prisma, type PrismaClient } from "../../generated/client/client";

/**
 * Idempotencia de `POST /api/stripe/webhook` (specs/13 §7): Stripe reintenta
 * y no garantiza entrega única. `stripeWebhookEvent` (0007_purchases) es la
 * tabla de apoyo: `id` = `event.id` de Stripe.
 */
export interface WebhookEventDedupeStore {
  /** `true` la primera vez que se ve `eventId` (y lo registra); `false` si ya estaba. */
  recordIfNew(eventId: string, type: string): Promise<boolean>;
  /**
   * Deshace `recordIfNew` si el procesado falla (el adaptador responde 500 y
   * Stripe reintenta el MISMO `event.id`; sin esto quedaría marcado como
   * visto y el reintento nunca se procesaría).
   */
  forget(eventId: string): Promise<void>;
}

export function createPrismaWebhookEventDedupeStore(prisma: PrismaClient): WebhookEventDedupeStore {
  return {
    async recordIfNew(eventId, type) {
      try {
        await prisma.stripeWebhookEvent.create({ data: { id: eventId, type } });
        return true;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
        throw err;
      }
    },
    async forget(eventId) {
      await prisma.stripeWebhookEvent.deleteMany({ where: { id: eventId } });
    },
  };
}

export function createInMemoryWebhookEventDedupeStore(): WebhookEventDedupeStore & { seen: Set<string> } {
  const seen = new Set<string>();
  return {
    seen,
    async recordIfNew(eventId) {
      if (seen.has(eventId)) return false;
      seen.add(eventId);
      return true;
    },
    async forget(eventId) {
      seen.delete(eventId);
    },
  };
}
