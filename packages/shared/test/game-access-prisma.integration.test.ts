import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/client";
import { createPrismaClient } from "../src/db";
import { createPrismaGameAccessStore } from "../src/services/game-access-prisma-store";
import type { RoomPackage } from "../src/schemas";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:migrate
//   pnpm --filter @escaperoom/shared test game-access-prisma
//
// Remate de #140 (bloque 4, auditoría 2026-09-24): `claimPlaySession` debe
// exigir `status = 'succeeded'` en la compra. Antes de este fix, una compra
// reembolsada (`status = 'refunded'`) con un `gameToken` aún vigente (caduca
// a los 15 min, no al reembolsar) podía arrancar una partida igualmente.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url)),
    "utf8",
  ),
) as RoomPackage;

const TAG = `it540${randomUUID().slice(0, 8)}`;

describe.skipIf(!process.env.DATABASE_URL)(
  "claimPlaySession sobre Postgres (integración)",
  () => {
    let prisma: PrismaClient;
    const userId = `${TAG}-comprador`;
    let roomVersionId = "";
    const store = () => createPrismaGameAccessStore(prisma);
    let purchaseSeq = 0;
    const makePurchase = (status: "pending" | "succeeded" | "refunded") =>
      prisma.purchase.create({
        data: {
          userId,
          purchaseType: "room",
          roomVersionId,
          amountCents: 500,
          stripePaymentIntentId: `${TAG}-pi-${(purchaseSeq += 1)}`,
          status,
        },
      });

    beforeAll(async () => {
      prisma = createPrismaClient();
      await prisma.user.create({ data: { id: userId, name: userId, email: `${userId}@test.local` } });
      const room = await prisma.room.create({
        data: { authorId: userId, title: TAG, status: "published" },
      });
      const version = await prisma.roomVersion.create({
        data: {
          roomId: room.id,
          semver: "1.0.0",
          assetsHash: "sha256:test",
          publishedBy: userId,
          package: { ...fixture, meta: { ...fixture.meta, id: room.id, version: "1.0.0" } } as object,
        },
      });
      roomVersionId = version.id;
    });

    afterAll(async () => {
      await prisma.purchase.deleteMany({ where: { userId } });
      if (roomVersionId) await prisma.roomVersion.deleteMany({ where: { id: roomVersionId } });
      await prisma.room.deleteMany({ where: { authorId: userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    it("una compra reembolsada no puede reclamar partida", async () => {
      const purchase = await makePurchase("refunded");
      const claimed = await store().claimPlaySession(purchase.id, "room-refunded");
      expect(claimed).toBe(false);
      const after = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
      expect(after.playSessionStartedAt).toBeNull();
      expect(after.playSessionColyseusId).toBeNull();
    });

    it("una compra pendiente (aún no confirmada por el webhook) tampoco reclama", async () => {
      const purchase = await makePurchase("pending");
      const claimed = await store().claimPlaySession(purchase.id, "room-pending");
      expect(claimed).toBe(false);
    });

    it("una compra succeeded reclama con normalidad", async () => {
      const purchase = await makePurchase("succeeded");
      const claimed = await store().claimPlaySession(purchase.id, "room-ok");
      expect(claimed).toBe(true);
      const after = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
      expect(after.playSessionColyseusId).toBe("room-ok");
    });
  },
);
