import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/client/client";
import { createPrismaClient } from "../src/db";
import { InsufficientCreditsError, createPrismaCreditAccountStore, type Actor } from "../src/services";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:migrate
//   pnpm --filter @escaperoom/shared test credits-prisma
//
// Comprueba `createPrismaCreditAccountStore` contra la migración 0004: la
// función SQL `applyCreditMovement`, el CHECK "balanceCredits" >= 0 (aborta la
// transacción entera de un consumo mayor que el saldo, sin dejar rastro) y que
// `ensureAccountForActor` crea la cuenta personal o de organización una sola
// vez (índice único parcial).
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const TAG = `it49${randomUUID().slice(0, 8)}`;

describe.skipIf(!process.env.DATABASE_URL)("créditos sobre Postgres (integración)", () => {
  let prisma: PrismaClient;
  const userId = `${TAG}-user`;
  const actor: Actor = { userId, organizationId: null, role: "member" };

  beforeAll(async () => {
    prisma = createPrismaClient();
    await prisma.user.create({
      data: { id: userId, name: "Creadora de prueba", email: `${TAG}@escaperoom.local` },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    const account = await prisma.creditAccount.findFirst({ where: { userId } });
    if (account) {
      await prisma.creditMovement.deleteMany({ where: { accountId: account.id } });
      await prisma.creditAccount.deleteMany({ where: { id: account.id } });
    }
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("crea la cuenta una sola vez y aplica movimientos con el saldo correcto", async () => {
    const store = createPrismaCreditAccountStore(prisma);

    const first = await store.ensureAccountForActor(actor);
    const second = await store.ensureAccountForActor(actor);
    expect(first.id).toBe(second.id);
    expect(first.balanceCredits).toBe(0n);

    const afterPurchase = await store.applyMovement({
      accountId: first.id,
      type: "purchase",
      amountCredits: 10n,
      referenceType: "test",
      referenceId: "purchase-1",
      createdBy: userId,
    });
    expect(afterPurchase).toBe(10n);

    const afterConsumption = await store.applyMovement({
      accountId: first.id,
      type: "consumption",
      amountCredits: -3n,
      referenceType: "audio_generation",
      referenceId: "dialog-1:es",
      createdBy: userId,
    });
    expect(afterConsumption).toBe(7n);

    const movements = await prisma.creditMovement.findMany({
      where: { accountId: first.id },
      orderBy: { id: "asc" },
    });
    expect(movements).toMatchObject([
      { movementType: "purchase", amountCredits: 10n, balanceAfter: 10n },
      { movementType: "consumption", amountCredits: -3n, balanceAfter: 7n },
    ]);
  });

  it("el CHECK de saldo aborta el consumo entero (no queda movimiento ni cambia el saldo)", async () => {
    const store = createPrismaCreditAccountStore(prisma);
    const account = await store.ensureAccountForActor(actor);

    await expect(
      store.applyMovement({
        accountId: account.id,
        type: "consumption",
        amountCredits: -(account.balanceCredits + 1000n),
        referenceType: "audio_generation",
        referenceId: "dialog-2:es",
        createdBy: userId,
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);

    const after = await store.getAccount(account.id);
    expect(after?.balanceCredits).toBe(account.balanceCredits);
    const movement = await prisma.creditMovement.findFirst({
      where: { accountId: account.id, referenceId: "dialog-2:es" },
    });
    expect(movement).toBeNull();
  });
});
