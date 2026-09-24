import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client";
import { createPrismaPurchaseConfirmationStore } from "../src/services";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:migrate
//   pnpm --filter @escaperoom/shared test purchase-confirmation-prisma
//
// Comprueba el outbox mínimo (E-11): markConfirmationSent persiste la marca
// en Postgres y findPendingConfirmations la usa para encontrar (o dejar de
// encontrar) compras "succeeded" pendientes de confirmar. Solo cubre `room`/
// `room_license` (vía `purchase`): `event_credits` usa la misma consulta
// contra `event.confirmationSentAt`, sin lógica adicional que justifique
// duplicar aquí el fixture (organizador + roomVersion + evento).
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const TAG = `it114${randomUUID().slice(0, 8)}`;

describe.skipIf(!process.env.DATABASE_URL)(
  "outbox del email de confirmación de compra sobre Postgres (integración, E-11)",
  () => {
    let prisma: PrismaClient;
    const userId = `${TAG}-user`;
    let roomVersionId = "";

    beforeAll(async () => {
      prisma = new PrismaClient();
      await prisma.user.create({
        data: { id: userId, name: "Compradora de prueba", email: `${TAG}@escaperoom.local` },
      });
      // Fixture mínimo: chkPurchaseTarget exige roomVersionId para room/room_license.
      const room = await prisma.room.create({
        data: { authorId: userId, title: `Sala de prueba ${TAG}` },
      });
      const roomVersion = await prisma.roomVersion.create({
        data: {
          roomId: room.id,
          semver: "1.0.0",
          package: {},
          assetsHash: "test",
          publishedBy: userId,
        },
      });
      roomVersionId = roomVersion.id;
    });

    afterAll(async () => {
      if (!prisma) return;
      const roomVersion = roomVersionId
        ? await prisma.roomVersion.findUnique({ where: { id: roomVersionId } })
        : null;
      await prisma.purchase.deleteMany({ where: { userId } });
      if (roomVersion) {
        await prisma.roomVersion.deleteMany({ where: { id: roomVersion.id } });
        await prisma.room.deleteMany({ where: { id: roomVersion.roomId } });
      }
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    it("findPendingConfirmations encuentra una succeeded sin confirmationSentAt y deja de hacerlo tras markConfirmationSent", async () => {
      const store = createPrismaPurchaseConfirmationStore(prisma);
      const past = new Date(Date.now() - 3_600_000);

      const purchase = await prisma.purchase.create({
        data: {
          userId,
          purchaseType: "room",
          roomVersionId,
          amountCents: 1999,
          status: "succeeded",
          stripePaymentIntentId: `pi_${TAG}`,
        },
      });

      const cutoff = new Date(); // creada "antes de ahora": cae dentro de la ventana del barrido.
      const pendingBefore = await store.findPendingConfirmations(cutoff);
      expect(pendingBefore).toContainEqual({ kind: "room", purchaseId: purchase.id });

      await store.markConfirmationSent({ kind: "room", purchaseId: purchase.id });

      const confirmed = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
      expect(confirmed.confirmationSentAt).not.toBeNull();

      const pendingAfter = await store.findPendingConfirmations(cutoff);
      expect(pendingAfter).not.toContainEqual({ kind: "room", purchaseId: purchase.id });

      // Una compra demasiado reciente (dentro del margen de gracia) no cuenta
      // como pendiente, aunque no tenga confirmationSentAt: el webhook todavía
      // no ha tenido tiempo de intentarlo.
      expect(await store.findPendingConfirmations(past)).not.toContainEqual({
        kind: "room",
        purchaseId: purchase.id,
      });
    });

    it("una compra pending (no succeeded) nunca es pendiente de confirmación", async () => {
      const store = createPrismaPurchaseConfirmationStore(prisma);
      const purchase = await prisma.purchase.create({
        data: { userId, purchaseType: "room_license", roomVersionId, amountCents: 0, status: "pending" },
      });
      const cutoff = new Date();
      expect(await store.findPendingConfirmations(cutoff)).not.toContainEqual({
        kind: "room_license",
        purchaseId: purchase.id,
      });
    });
  },
);
