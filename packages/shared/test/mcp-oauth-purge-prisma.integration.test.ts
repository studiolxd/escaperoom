import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/client/client";
import { createPrismaClient } from "../src/db";
import { createPrismaMcpOAuthPurgeStore } from "../src/services/mcp-oauth-purge-prisma-store";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:reset
//   pnpm --filter @escaperoom/shared test mcp-oauth-purge-prisma
//
// A-15: `verification` (compartida con magic links y el resto de Better Auth)
// acumula sin límite las filas `mcp-oauth:*` (códigos, tokens, marcas de
// refresh usado y de grant revocado) hasta que algo las purgue.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const TAG = `itmcpoauth${randomUUID().slice(0, 8)}`;

describe.skipIf(!process.env.DATABASE_URL)(
  "purga del OAuth del MCP sobre Postgres (integración, A-15)",
  () => {
    let prisma: PrismaClient;
    const ids: string[] = [];

    async function row(suffix: string, identifierPrefix: string, expiresAt: Date) {
      const id = `${TAG}-${suffix}`;
      await prisma.verification.create({
        data: { id, identifier: `${identifierPrefix}${TAG}-${suffix}`, value: "{}", expiresAt },
      });
      ids.push(id);
      return id;
    }

    beforeAll(() => {
      prisma = createPrismaClient();
    });

    afterAll(async () => {
      if (!prisma) return;
      await prisma.verification.deleteMany({ where: { id: { in: ids } } });
      await prisma.$disconnect();
    });

    it("borra solo las filas mcp-oauth:* caducadas; deja el resto intacto", async () => {
      const past = new Date(Date.now() - 60 * 60 * 1000);
      const future = new Date(Date.now() + 60 * 60 * 1000);

      const expiredMcp = await row("expired", "mcp-oauth:", past);
      const liveMcp = await row("live", "mcp-oauth:", future);
      // Fila de otro subsistema (magic link) con el mismo patrón de caducidad:
      // nunca debe tocarla un `startsWith("mcp-oauth:")`.
      const expiredOther = await row("expired-other", "magic-link:", past);

      const store = createPrismaMcpOAuthPurgeStore(prisma);
      const deleted = await store.purgeExpired(new Date());
      expect(deleted).toBeGreaterThanOrEqual(1);

      const remaining = await prisma.verification.findMany({
        where: { id: { in: [expiredMcp, liveMcp, expiredOther] } },
        select: { id: true },
      });
      const remainingIds = new Set(remaining.map((r) => r.id));
      expect(remainingIds.has(expiredMcp)).toBe(false);
      expect(remainingIds.has(liveMcp)).toBe(true);
      expect(remainingIds.has(expiredOther)).toBe(true);
    });
  },
);
