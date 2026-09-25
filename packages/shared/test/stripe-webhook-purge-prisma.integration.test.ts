import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client";
import { stripeWebhookEventPurgeCutoff } from "../src/services/stripe-webhook-purge";
import { createPrismaStripeWebhookEventPurgeStore } from "../src/services/stripe-webhook-purge-prisma-store";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:reset
//   pnpm --filter @escaperoom/shared test stripe-webhook-purge-prisma
//
// Comprueba `createPrismaStripeWebhookEventPurgeStore` contra el esquema real
// (B-19): borra solo las filas anteriores al cutoff.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const TAG = `itswp${randomUUID().slice(0, 8)}`;
const NOW = new Date("2026-09-23T10:00:00Z");

describe.skipIf(!process.env.DATABASE_URL)(
  "purga de stripeWebhookEvent sobre Postgres (integración, B-19)",
  () => {
    let prisma: PrismaClient;
    const ids: string[] = [];

    beforeAll(async () => {
      prisma = new PrismaClient();
    });

    afterAll(async () => {
      if (!prisma) return;
      await prisma.stripeWebhookEvent.deleteMany({ where: { id: { in: ids } } });
      await prisma.$disconnect();
    });

    it("borra las filas de hace más de 30 días, deja intactas las recientes", async () => {
      const oldId = `${TAG}-old`;
      const recentId = `${TAG}-recent`;
      ids.push(oldId, recentId);
      await prisma.stripeWebhookEvent.create({
        data: { id: oldId, type: "checkout.session.completed", receivedAt: new Date("2026-01-01T00:00:00Z") },
      });
      await prisma.stripeWebhookEvent.create({
        data: { id: recentId, type: "checkout.session.completed", receivedAt: new Date() },
      });

      const store = createPrismaStripeWebhookEventPurgeStore(prisma);
      const deleted = await store.deleteExpired(stripeWebhookEventPurgeCutoff(NOW));
      expect(deleted).toBeGreaterThanOrEqual(1);

      expect(await prisma.stripeWebhookEvent.findUnique({ where: { id: oldId } })).toBeNull();
      expect(await prisma.stripeWebhookEvent.findUnique({ where: { id: recentId } })).not.toBeNull();
    });
  },
);
