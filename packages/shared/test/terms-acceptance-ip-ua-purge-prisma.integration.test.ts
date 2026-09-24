import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client";
import { createPrismaTermsAcceptanceIpUaPurgeStore } from "../src/services/terms-acceptance-ip-ua-purge-prisma-store";
import { hashPurgedValue, isPurgedValue } from "../src/services/ip-ua-purge";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:reset
//   pnpm --filter @escaperoom/shared test terms-acceptance-ip-ua-purge-prisma
//
// Comprueba `createPrismaTermsAcceptanceIpUaPurgeStore` contra el esquema
// real de `termsAcceptance`: hash de `ipAddress`/`userAgent` a los 90 días
// desde `acceptedAt`, idempotencia y borrado final de la fila a los 2 años.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const TAG = `ittermsip${randomUUID().slice(0, 8)}`;
const SECRET = "test-secret-terms-ip-ua";
const NOW = new Date();

describe.skipIf(!process.env.DATABASE_URL)(
  "purga de IP/user-agent de termsAcceptance sobre Postgres (integración)",
  () => {
    let prisma: PrismaClient;
    const userId = `${TAG}-user`;

    async function makeAcceptance(opts: {
      acceptedAt: Date;
      ipAddress: string | null;
      userAgent: string | null;
    }) {
      const row = await prisma.termsAcceptance.create({
        data: {
          userId,
          version: "v1",
          acceptedAt: opts.acceptedAt,
          ipAddress: opts.ipAddress,
          userAgent: opts.userAgent,
        },
      });
      return row.id;
    }

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

    it("hashea ip/user-agent de aceptaciones de hace más de 90 días, deja intactas las recientes", async () => {
      const old = new Date("2020-01-01T00:00:00Z");
      const recent = new Date();

      const oldId = await makeAcceptance({
        acceptedAt: old,
        ipAddress: "203.0.113.20",
        userAgent: "old-agent",
      });
      const recentId = await makeAcceptance({
        acceptedAt: recent,
        ipAddress: "203.0.113.21",
        userAgent: "recent-agent",
      });

      const store = createPrismaTermsAcceptanceIpUaPurgeStore(prisma);
      const hashed = await store.purgeIpUa(NOW, SECRET);
      expect(hashed).toBeGreaterThanOrEqual(1);

      const oldRow = await prisma.termsAcceptance.findUniqueOrThrow({ where: { id: oldId } });
      const recentRow = await prisma.termsAcceptance.findUniqueOrThrow({ where: { id: recentId } });

      expect(isPurgedValue(oldRow.ipAddress!)).toBe(true);
      expect(isPurgedValue(oldRow.userAgent!)).toBe(true);
      expect(recentRow.ipAddress).toBe("203.0.113.21");
      expect(recentRow.userAgent).toBe("recent-agent");

      // E-3: el hash de pgcrypto (clave derivada pasada desde Node) es
      // exactamente comparable con el que calcula `hashPurgedValue` en Node.
      expect(oldRow.ipAddress).toBe(hashPurgedValue("203.0.113.20", SECRET, "ip"));
      expect(oldRow.userAgent).toBe(hashPurgedValue("old-agent", SECRET, "ua"));
    });

    it("es idempotente: repetir la pasada no vuelve a hashear una fila ya purgada", async () => {
      const id = await makeAcceptance({
        acceptedAt: new Date("2019-01-01T00:00:00Z"),
        ipAddress: "203.0.113.22",
        userAgent: "idemp-agent",
      });

      const store = createPrismaTermsAcceptanceIpUaPurgeStore(prisma);
      await store.purgeIpUa(NOW, SECRET);
      const first = await prisma.termsAcceptance.findUniqueOrThrow({ where: { id } });

      await store.purgeIpUa(NOW, SECRET);
      const second = await prisma.termsAcceptance.findUniqueOrThrow({ where: { id } });

      expect(second.ipAddress).toBe(first.ipAddress);
      expect(second.userAgent).toBe(first.userAgent);
    });

    it("borra la fila entera a los 2 años", async () => {
      const threeYearsAgo = new Date();
      threeYearsAgo.setUTCFullYear(threeYearsAgo.getUTCFullYear() - 3);

      const oldId = await makeAcceptance({
        acceptedAt: threeYearsAgo,
        ipAddress: "203.0.113.23",
        userAgent: "expired-agent",
      });
      const recentId = await makeAcceptance({
        acceptedAt: new Date(),
        ipAddress: "203.0.113.24",
        userAgent: "recent-agent",
      });

      const store = createPrismaTermsAcceptanceIpUaPurgeStore(prisma);
      const deleted = await store.deleteExpiredRows(NOW);
      expect(deleted).toBeGreaterThanOrEqual(1);

      const oldRow = await prisma.termsAcceptance.findUnique({ where: { id: oldId } });
      const recentRow = await prisma.termsAcceptance.findUnique({ where: { id: recentId } });

      expect(oldRow).toBeNull();
      expect(recentRow).not.toBeNull();
    });
  },
);
