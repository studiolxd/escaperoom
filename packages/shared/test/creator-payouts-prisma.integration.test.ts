import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client";
import {
  createFakeConnectGateway,
  createFakePaymentGateway,
  createPrismaCreatorPayoutStore,
  processCreatorPayouts,
} from "../src/services";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:migrate
//   pnpm --filter @escaperoom/shared test creator-payouts-prisma
//
// Regresión de la revisión de PR #135 (segunda vuelta): `findPendingPayouts`
// ordenaba por `payoutAttemptAt ASC` a secas, y en Postgres `ORDER BY col ASC`
// deja los `NULL` al FINAL (`NULLS LAST` es el comportamiento implícito) —
// justo al revés de lo que hacía falta. El store falso de
// `creator-payouts.test.ts` no reproduce esto porque su `Array.sort` de JS SÍ
// pone `undefined`/`-Infinity` delante; solo una consulta real a Postgres
// puede confirmar que `nulls: "first"` funciona de verdad.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const TAG = `it135b${randomUUID().slice(0, 8)}`;
const LIMIT = 3;

describe.skipIf(!process.env.DATABASE_URL)("payouts a creadores sobre Postgres (integración, B-9)", () => {
  let prisma: PrismaClient;
  const buyerId = `${TAG}-buyer`;
  const blockedAuthorId = `${TAG}-blocked-author`;
  const payableAuthorId = `${TAG}-payable-author`;
  const roomIds: string[] = [];
  const roomVersionIds: string[] = [];
  const purchaseIds: string[] = [];
  let payablePurchaseId = "";

  async function newRoomVersion(authorId: string, seq: number): Promise<string> {
    const room = await prisma.room.create({
      data: { authorId, title: `Sala ${TAG} ${seq}` },
    });
    roomIds.push(room.id);
    const version = await prisma.roomVersion.create({
      data: { roomId: room.id, semver: "1.0.0", package: {}, assetsHash: "test", publishedBy: authorId },
    });
    roomVersionIds.push(version.id);
    return version.id;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.create({
      data: { id: buyerId, name: "Compradora de prueba", email: `${TAG}-buyer@escaperoom.local` },
    });
    // Sin `stripeAccountId`: `findCreatorAccountForVersion` no encuentra
    // cuenta y el payout se salta siempre — permanentemente "bloqueado".
    await prisma.user.create({
      data: { id: blockedAuthorId, name: "Autora sin Connect", email: `${TAG}-blocked@escaperoom.local` },
    });
    await prisma.user.create({
      data: {
        id: payableAuthorId,
        name: "Autora con Connect",
        email: `${TAG}-payable@escaperoom.local`,
        stripeAccountId: `acct_${TAG}`,
      },
    });

    // Más de `LIMIT` compras `succeeded` bloqueadas, YA intentadas antes
    // (`payoutAttemptAt` en el pasado): sin el fix, `ORDER BY payoutAttemptAt
    // ASC` (sin `nulls: "first"`) las deja delante de cualquier compra nueva
    // sin intentar, para siempre.
    const now = new Date();
    const pastAttempt = new Date(now.getTime() - 60_000);
    for (let i = 0; i < LIMIT + 2; i++) {
      const roomVersionId = await newRoomVersion(blockedAuthorId, i);
      const purchase = await prisma.purchase.create({
        data: {
          userId: buyerId,
          purchaseType: "room",
          roomVersionId,
          amountCents: 1000,
          creatorShareCents: 700,
          status: "succeeded",
          stripePaymentIntentId: `pi_blocked_${TAG}_${i}`,
          payoutAttemptAt: pastAttempt,
        },
      });
      purchaseIds.push(purchase.id);
    }

    // La compra pagable: nunca intentada (`payoutAttemptAt` NULL) — debe
    // entrar en el primer lote pese a haber más de `LIMIT` bloqueadas.
    const payableVersionId = await newRoomVersion(payableAuthorId, 999);
    const payable = await prisma.purchase.create({
      data: {
        userId: buyerId,
        purchaseType: "room",
        roomVersionId: payableVersionId,
        amountCents: 1000,
        creatorShareCents: 700,
        status: "succeeded",
        stripePaymentIntentId: `pi_payable_${TAG}`,
      },
    });
    payablePurchaseId = payable.id;
    purchaseIds.push(payable.id);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
    await prisma.roomVersion.deleteMany({ where: { id: { in: roomVersionIds } } });
    await prisma.room.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [buyerId, blockedAuthorId, payableAuthorId] } } });
    await prisma.$disconnect();
  });

  it("una compra nunca intentada entra en el primer lote aunque haya más de `limit` compras ya intentadas y bloqueadas por delante", async () => {
    const store = createPrismaCreatorPayoutStore(prisma);
    const connect = createFakeConnectGateway();
    connect.accounts.set(`acct_${TAG}`, "complete");
    const payments = createFakePaymentGateway();

    const result = await processCreatorPayouts({ store, connect, payments }, { limit: LIMIT });

    // Si `findPendingPayouts` volviera a dejar los `NULL` al final, este
    // lote de `LIMIT` filas serían las `LIMIT` bloqueadas más antiguas y la
    // pagable nunca se transferiría en esta pasada.
    expect(result.transferred).toBe(1);
    const payableRow = await prisma.purchase.findUniqueOrThrow({ where: { id: payablePurchaseId } });
    expect(payableRow.stripeTransferId).toBe("fake_tr_1");
  });
});
