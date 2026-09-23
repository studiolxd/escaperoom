import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client";
import { createPrismaTermsAcceptanceStore } from "../src/services/legal-acceptance-prisma-store";
import { createTermsAcceptanceService } from "../src/services/legal-acceptance";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:migrate
//   pnpm --filter @escaperoom/shared test legal-acceptance-prisma
//
// Comprueba `createPrismaTermsAcceptanceStore` contra la migración
// `add_terms_acceptance`: el histórico inmutable en `termsAcceptance` y el
// campo desnormalizado `user.termsAcceptedVersion`.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const TAG = `it-terms-${randomUUID().slice(0, 8)}`;

describe.skipIf(!process.env.DATABASE_URL)("reaceptación de términos sobre Postgres (integración)", () => {
  let prisma: PrismaClient;
  const userId = TAG;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.create({ data: { id: userId, name: TAG, email: `${userId}@test.local` } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.termsAcceptance.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("un usuario recién creado nunca aceptó ninguna versión", async () => {
    const service = createTermsAcceptanceService({
      store: createPrismaTermsAcceptanceStore(prisma),
    });

    const status = await service.getStatus(userId);

    expect(status.needsAcceptance).toBe(true);
  });

  it("aceptar crea el histórico inmutable y desnormaliza la versión en `user`", async () => {
    const service = createTermsAcceptanceService({
      store: createPrismaTermsAcceptanceStore(prisma),
    });

    const row = await service.accept(userId, { ipAddress: "9.9.9.9", userAgent: "integration-test" });

    expect(row).toMatchObject({ userId, ipAddress: "9.9.9.9", userAgent: "integration-test" });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.termsAcceptedVersion).toBe(row.version);

    const history = await prisma.termsAcceptance.findMany({ where: { userId } });
    expect(history).toHaveLength(1);

    const status = await service.getStatus(userId);
    expect(status.needsAcceptance).toBe(false);
  });

  it("aceptar de nuevo añade otra fila al histórico sin borrar la anterior", async () => {
    const service = createTermsAcceptanceService({
      store: createPrismaTermsAcceptanceStore(prisma),
    });

    await service.accept(userId, { ipAddress: null, userAgent: null });

    const history = await prisma.termsAcceptance.findMany({ where: { userId } });
    expect(history.length).toBeGreaterThanOrEqual(2);
  });
});
