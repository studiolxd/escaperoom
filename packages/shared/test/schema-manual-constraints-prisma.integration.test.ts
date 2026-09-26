import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/client/client";
import { createPrismaClient } from "../src/db";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI hay Postgres (ver E-14), así que
// corre; en local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:migrate
//   pnpm --filter @escaperoom/shared test schema-manual-constraints
//
// E-18: índices parciales/únicos, CHECKs y triggers creados a mano en SQL
// (migraciones) que `schema.prisma` no puede representar — documentados con
// comentarios `///` junto a cada modelo, pero invisibles para Prisma. Nada
// impide que un `prisma migrate dev` calculado sobre el esquema (que no los
// conoce) proponga un `DROP INDEX`/`DROP TRIGGER`/`DROP CONSTRAINT` para
// "corregir" el drift aparente. Este test comprueba contra la BD real que
// siguen ahí: si alguien aplica esa clase de migración sin editarla a mano,
// esto falla en vez de perder en silencio la protección (dedupe de Stripe,
// purgas RGPD, `updatedAt` gestionado por trigger…).
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

describe.skipIf(!process.env.DATABASE_URL)(
  "índices/CHECKs/triggers manuales sobre Postgres (integración, E-18)",
  () => {
    let prisma: PrismaClient;

    beforeAll(() => {
      prisma = createPrismaClient();
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    async function indexDef(indexName: string): Promise<string | null> {
      const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = ${indexName}
      `;
      return rows[0]?.indexdef ?? null;
    }

    async function constraintExists(constraintName: string): Promise<boolean> {
      const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = ${constraintName}
        ) AS exists
      `;
      return rows[0]?.exists ?? false;
    }

    async function constraintDef(constraintName: string): Promise<string | null> {
      const rows = await prisma.$queryRaw<{ definition: string }[]>`
        SELECT pg_get_constraintdef(oid) AS definition
          FROM pg_constraint WHERE conname = ${constraintName}
      `;
      return rows[0]?.definition ?? null;
    }

    async function triggerExists(triggerName: string, tableName: string): Promise<boolean> {
      const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          WHERE t.tgname = ${triggerName} AND c.relname = ${tableName} AND NOT t.tgisinternal
        ) AS exists
      `;
      return rows[0]?.exists ?? false;
    }

    it("uxCreditAccountUser/uxCreditAccountOrg siguen siendo únicos y parciales (0004_credits)", async () => {
      const user = await indexDef("uxCreditAccountUser");
      const org = await indexDef("uxCreditAccountOrg");
      expect(user).toMatch(/UNIQUE INDEX/);
      expect(user).toMatch(/WHERE \("userId" IS NOT NULL\)/);
      expect(org).toMatch(/UNIQUE INDEX/);
      expect(org).toMatch(/WHERE \("organizationId" IS NOT NULL\)/);
    });

    it("chkCreditAccountOwner y trgCreditAccountUpdatedAt siguen ahí (0004_credits)", async () => {
      expect(await constraintExists("chkCreditAccountOwner")).toBe(true);
      expect(await triggerExists("trgCreditAccountUpdatedAt", "creditAccount")).toBe(true);
    });

    it("ixRoomCatalog y trgRoomUpdatedAt siguen ahí (0005_rooms)", async () => {
      const catalog = await indexDef("ixRoomCatalog");
      expect(catalog).toMatch(
        /WHERE \(\(status = 'published'::"roomStatus"\) AND \("deletedAt" IS NULL\)\)/,
      );
      expect(await triggerExists("trgRoomUpdatedAt", "room")).toBe(true);
    });

    it("trgReviewUpdatedAt sigue ahí (0009_reviews)", async () => {
      expect(await triggerExists("trgReviewUpdatedAt", "review")).toBe(true);
    });

    it("review_rating_check admite la escala doblada 2–10 (medios puntos, 20260925160000)", async () => {
      const def = await constraintDef("review_rating_check");
      expect(def).toMatch(/rating >= 2/);
      expect(def).toMatch(/rating <= 10/);
    });

    it("ixContentReportStatus/ixContentReportRoom siguen siendo parciales (0010/0016)", async () => {
      const status = await indexDef("ixContentReportStatus");
      const room = await indexDef("ixContentReportRoom");
      expect(status).toMatch(/WHERE \(status = 'pending'::"contentReportStatus"\)/);
      expect(room).toMatch(/WHERE \("roomId" IS NOT NULL\)/);
    });

    it("ixModerationAppealStatus sigue siendo parcial (0010_moderation)", async () => {
      const status = await indexDef("ixModerationAppealStatus");
      expect(status).toMatch(/WHERE \(status = 'pending'::text\)/);
    });

    it("uxPurchaseStripePi/uxPurchaseOwnedRoom y sus CHECKs siguen ahí (0007_purchases, B-16)", async () => {
      const stripePi = await indexDef("uxPurchaseStripePi");
      const ownedRoom = await indexDef("uxPurchaseOwnedRoom");
      expect(stripePi).toMatch(/UNIQUE INDEX/);
      expect(stripePi).toMatch(/WHERE \("stripePaymentIntentId" IS NOT NULL\)/);
      expect(ownedRoom).toMatch(/UNIQUE INDEX/);
      expect(ownedRoom).toMatch(
        /WHERE \(\("purchaseType" = 'room'::"purchaseType"\) AND \(status = 'succeeded'::"purchaseStatus"\)\)/,
      );
      expect(await constraintExists("chkPurchaseTarget")).toBe(true);
      expect(await constraintExists("chkPurchasePaidNeedsStripe")).toBe(true);
    });

    it("ixAudioAssetStatusCreatedAt sustituye al parcial ixAudioAssetPending y cubre los 3 status (E-18)", async () => {
      expect(await indexDef("ixAudioAssetPending")).toBeNull();
      const statusCreatedAt = await indexDef("ixAudioAssetStatusCreatedAt");
      expect(statusCreatedAt).toMatch(/USING btree \(status, "createdAt"\)/);
      expect(statusCreatedAt).not.toMatch(/WHERE/);
    });

    it("los parciales de purga RGPD de #139 siguen ahí (E-7/E-18)", async () => {
      const accessKeySweep = await indexDef("ixAccessKeyExpirySweep");
      const accessKeyEmail = await indexDef("ixAccessKeyEventEmailPending");
      const sessionUnpurged = await indexDef("ixSessionCreatedAtUnpurged");
      const termsUnpurged = await indexDef("ixTermsAcceptanceAcceptedAtUnpurged");
      expect(accessKeySweep).toMatch(/WHERE \(.*"expiresAt" IS NOT NULL\)/);
      expect(accessKeyEmail).toMatch(/WHERE \(\(email IS NOT NULL\) AND \(email !~~ 'purged:%'/);
      expect(sessionUnpurged).toMatch(/WHERE/);
      expect(termsUnpurged).toMatch(/WHERE/);
    });
  },
);
