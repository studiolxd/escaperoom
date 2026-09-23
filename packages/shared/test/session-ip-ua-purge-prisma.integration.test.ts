import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client";
import { createPrismaSessionIpUaPurgeStore } from "../src/services/session-ip-ua-purge-prisma-store";
import { isPurgedValue } from "../src/services/ip-ua-purge";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:reset
//   pnpm --filter @escaperoom/shared test session-ip-ua-purge-prisma
//
// Comprueba `createPrismaSessionIpUaPurgeStore` contra el esquema real de
// `session` (Better Auth): hash de `ipAddress`/`userAgent` a los 90 días, la
// idempotencia con pgcrypto y que el borrado final (2 años) se limita a
// sesiones ya caducadas.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const TAG = `itsessip${randomUUID().slice(0, 8)}`;
const SECRET = "test-secret-session-ip-ua";
const NOW = new Date();

describe.skipIf(!process.env.DATABASE_URL)(
  "purga de IP/user-agent de session sobre Postgres (integración)",
  () => {
    let prisma: PrismaClient;
    const userId = `${TAG}-user`;
    const sessionIds: string[] = [];

    async function makeSession(opts: {
      code: string;
      createdAt: Date;
      expiresAt: Date;
      ipAddress: string | null;
      userAgent: string | null;
    }) {
      const session = await prisma.session.create({
        data: {
          id: `${TAG}-${opts.code}`,
          token: `${TAG}-${opts.code}-token`,
          userId,
          createdAt: opts.createdAt,
          updatedAt: opts.createdAt,
          expiresAt: opts.expiresAt,
          ipAddress: opts.ipAddress,
          userAgent: opts.userAgent,
        },
      });
      sessionIds.push(session.id);
      return session.id;
    }

    beforeAll(async () => {
      prisma = new PrismaClient();
      await prisma.user.create({ data: { id: userId, name: TAG, email: `${userId}@test.local` } });
    });

    afterAll(async () => {
      if (!prisma) return;
      await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    it("hashea ip/user-agent de sesiones de hace más de 90 días, deja intactas las recientes", async () => {
      const old = new Date("2020-01-01T00:00:00Z");
      const recent = new Date();

      const oldId = await makeSession({
        code: "old",
        createdAt: old,
        expiresAt: new Date("2020-01-08T00:00:00Z"),
        ipAddress: "203.0.113.7",
        userAgent: "old-agent",
      });
      const recentId = await makeSession({
        code: "recent",
        createdAt: recent,
        expiresAt: new Date(recent.getTime() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: "203.0.113.8",
        userAgent: "recent-agent",
      });

      const store = createPrismaSessionIpUaPurgeStore(prisma);
      const hashed = await store.purgeIpUa(NOW, SECRET);
      expect(hashed).toBeGreaterThanOrEqual(1);

      const rows = await prisma.session.findMany({ where: { id: { in: [oldId, recentId] } } });
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

      expect(isPurgedValue(byId[oldId]!.ipAddress!)).toBe(true);
      expect(isPurgedValue(byId[oldId]!.userAgent!)).toBe(true);
      expect(byId[recentId]!.ipAddress).toBe("203.0.113.8");
      expect(byId[recentId]!.userAgent).toBe("recent-agent");
    });

    it("es idempotente: repetir la pasada no vuelve a hashear una sesión ya purgada", async () => {
      const id = await makeSession({
        code: "idemp",
        createdAt: new Date("2019-01-01T00:00:00Z"),
        expiresAt: new Date("2019-01-08T00:00:00Z"),
        ipAddress: "203.0.113.9",
        userAgent: "idemp-agent",
      });

      const store = createPrismaSessionIpUaPurgeStore(prisma);
      await store.purgeIpUa(NOW, SECRET);
      const first = await prisma.session.findUniqueOrThrow({ where: { id } });

      await store.purgeIpUa(NOW, SECRET);
      const second = await prisma.session.findUniqueOrThrow({ where: { id } });

      expect(second.ipAddress).toBe(first.ipAddress);
      expect(second.userAgent).toBe(first.userAgent);
    });

    it("borra la fila a los 2 años, solo si la sesión ya caducó", async () => {
      const twoYearsAgo = new Date();
      twoYearsAgo.setUTCFullYear(twoYearsAgo.getUTCFullYear() - 3);

      const expiredId = await makeSession({
        code: "expired-old",
        createdAt: twoYearsAgo,
        expiresAt: new Date(twoYearsAgo.getTime() + 7 * 24 * 60 * 60 * 1000), // caducó hace años
        ipAddress: "203.0.113.10",
        userAgent: "expired-agent",
      });
      const stillActiveId = await makeSession({
        code: "still-active",
        createdAt: twoYearsAgo,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // caduca en el futuro (hipotético)
        ipAddress: "203.0.113.11",
        userAgent: "active-agent",
      });

      const store = createPrismaSessionIpUaPurgeStore(prisma);
      const deleted = await store.deleteExpiredRows(NOW);
      expect(deleted).toBeGreaterThanOrEqual(1);

      const expiredRow = await prisma.session.findUnique({ where: { id: expiredId } });
      const stillActiveRow = await prisma.session.findUnique({ where: { id: stillActiveId } });

      expect(expiredRow).toBeNull();
      expect(stillActiveRow).not.toBeNull();
    });
  },
);
