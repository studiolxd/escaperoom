import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/client";
import { createPrismaClient } from "../src/db";
import { hashPurgedEmail, readEmailPurgeSecret } from "../src/services/access-key-email-purge";
import { hashPurgedValue, readIpUaPurgeSecret } from "../src/services/ip-ua-purge";
import {
  createPrismaUserDataRightsStore,
  type UserDataRightsStoreDeps,
} from "../src/services/user-data-rights-prisma-store";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:reset
//   pnpm --filter @escaperoom/shared test user-data-rights-prisma
//
// Comprueba `createPrismaUserDataRightsStore#anonymizeAccount` (A-5/E-5) contra
// el esquema real: tras el borrado no debe quedar PII identificable del
// usuario en ninguna de las tablas que la referencian.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const TAG = `itudr${randomUUID().slice(0, 8)}`;

describe.skipIf(!process.env.DATABASE_URL)(
  "anonymizeAccount sobre Postgres (integración, A-5/E-5)",
  () => {
    let prisma: PrismaClient;
    let deletedKeys: string[];
    let deps: UserDataRightsStoreDeps;

    beforeAll(() => {
      prisma = createPrismaClient();
    });

    afterAll(async () => {
      if (!prisma) return;
      await prisma.$disconnect();
    });

    beforeAll(() => {
      deletedKeys = [];
      deps = {
        deleteStorageObject: async (key) => {
          deletedKeys.push(key);
        },
      };
    });

    it("borra sesiones/credenciales, membresías e invitaciones, revoca grants MCP, hashea IP/UA y el email de participante, y borra el avatar propio", async () => {
      const userId = `${TAG}-user`;
      const email = `${TAG}-user@test.local`;
      await prisma.user.create({
        data: { id: userId, name: "Autora", email, image: `avatars/${TAG}.png` },
      });

      const orgId = `${TAG}-org`;
      await prisma.organization.create({ data: { id: orgId, name: TAG, slug: `${TAG}-slug` } });
      // Miembro normal (no owner): el borrado no debe verse bloqueado por la
      // guardia de único owner, que solo mira las organizaciones que preside.
      await prisma.member.create({
        data: { id: `${TAG}-member`, organizationId: orgId, userId, role: "member" },
      });

      await prisma.invitation.create({
        data: {
          id: `${TAG}-invite`,
          organizationId: orgId,
          email,
          inviterId: userId,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });

      const session = await prisma.session.create({
        data: {
          id: `${TAG}-session`,
          token: `${TAG}-session-token`,
          userId,
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      await prisma.account.create({
        data: { id: `${TAG}-account`, accountId: userId, providerId: "google", userId },
      });

      // Magic link vigente emitido a su email (Better Auth: identifier = token, value = {email, name}).
      await prisma.verification.create({
        data: {
          id: `${TAG}-magic`,
          identifier: `${TAG}-magic-token`,
          value: JSON.stringify({ email, name: "Autora" }),
          expiresAt: new Date(Date.now() + 300_000),
        },
      });
      // Grant OAuth del MCP del usuario.
      const grantId = `${TAG}-grant`;
      await prisma.verification.create({
        data: {
          id: `${TAG}-mcp-access`,
          identifier: "mcp-oauth:access:abc",
          value: JSON.stringify({ userId, organizationId: null, clientId: "c1", scope: "*", grantId }),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      // Grant de otro usuario: no debe tocarse.
      await prisma.verification.create({
        data: {
          id: `${TAG}-mcp-access-other`,
          identifier: "mcp-oauth:access:def",
          value: JSON.stringify({
            userId: "otro-usuario",
            organizationId: null,
            clientId: "c1",
            scope: "*",
            grantId: "otro-grant",
          }),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });

      const terms = await prisma.termsAcceptance.create({
        data: {
          userId,
          version: "v1",
          acceptedAt: new Date(),
          ipAddress: "203.0.113.50",
          userAgent: "test-agent",
        },
      });

      // Clave de acceso donde participó (email coincide) y otra ajena.
      const organizerId = `${TAG}-organizer`;
      await prisma.user.create({
        data: { id: organizerId, name: organizerId, email: `${organizerId}@test.local` },
      });
      const room = await prisma.room.create({
        data: { authorId: organizerId, title: TAG, status: "published" },
      });
      const version = await prisma.roomVersion.create({
        data: {
          roomId: room.id,
          semver: "1.0.0",
          assetsHash: "sha256:test",
          publishedBy: organizerId,
          package: { meta: { id: room.id, version: "1.0.0" } } as object,
        },
      });
      const event = await prisma.event.create({
        data: {
          organizerId,
          roomVersionId: version.id,
          title: TAG,
          audience: "general",
          status: "active",
          pricingSnapshot: {},
          playersPurchased: 8,
        },
      });
      await prisma.accessKey.create({
        data: {
          code: `${TAG}-KEY`,
          eventId: event.id,
          keyType: "individual",
          status: "used",
          singleUse: true,
          seats: 1,
          redeemedCount: 1,
          email,
        },
      });
      const unrelatedKey = `${TAG}-KEY-OTHER`;
      await prisma.accessKey.create({
        data: {
          code: unrelatedKey,
          eventId: event.id,
          keyType: "individual",
          status: "used",
          singleUse: true,
          seats: 1,
          redeemedCount: 1,
          email: "otra-persona@test.local",
        },
      });

      const store = createPrismaUserDataRightsStore(prisma, deps);
      const at = new Date();
      await store.anonymizeAccount(userId, at);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.email).toMatch(/^deleted-.+@deleted\.escaperoom\.invalid$/);
      expect(user.email).not.toContain(userId);
      expect(user.name).toBe("Usuario eliminado");
      expect(user.image).toBeNull();
      expect(user.deletedAt?.getTime()).toBe(at.getTime());

      expect(await prisma.session.findUnique({ where: { id: session.id } })).toBeNull();
      expect(await prisma.account.findUnique({ where: { id: `${TAG}-account` } })).toBeNull();
      expect(await prisma.member.findUnique({ where: { id: `${TAG}-member` } })).toBeNull();
      expect(await prisma.invitation.findUnique({ where: { id: `${TAG}-invite` } })).toBeNull();

      expect(await prisma.verification.findUnique({ where: { id: `${TAG}-magic` } })).toBeNull();
      expect(await prisma.verification.findUnique({ where: { id: `${TAG}-mcp-access` } })).toBeNull();
      // El grant de otro usuario sigue intacto.
      expect(
        await prisma.verification.findUnique({ where: { id: `${TAG}-mcp-access-other` } }),
      ).not.toBeNull();
      const revoked = await prisma.verification.findFirst({
        where: { identifier: `mcp-oauth:revoked-grant:${grantId}` },
      });
      expect(revoked).not.toBeNull();

      const termsRow = await prisma.termsAcceptance.findUniqueOrThrow({ where: { id: terms.id } });
      const ipUaSecret = readIpUaPurgeSecret()!;
      expect(termsRow.ipAddress).toBe(hashPurgedValue("203.0.113.50", ipUaSecret, "ip"));
      expect(termsRow.userAgent).toBe(hashPurgedValue("test-agent", ipUaSecret, "ua"));

      const emailSecret = readEmailPurgeSecret()!;
      const key = await prisma.accessKey.findUniqueOrThrow({ where: { code: `${TAG}-KEY` } });
      expect(key.email).toBe(hashPurgedEmail(email, emailSecret));
      const other = await prisma.accessKey.findUniqueOrThrow({ where: { code: unrelatedKey } });
      expect(other.email).toBe("otra-persona@test.local");

      expect(deletedKeys).toContain(`avatars/${TAG}.png`);

      // Limpieza.
      await prisma.accessKey.deleteMany({ where: { eventId: event.id } });
      await prisma.event.deleteMany({ where: { id: event.id } });
      await prisma.roomVersion.deleteMany({ where: { id: version.id } });
      await prisma.room.deleteMany({ where: { id: room.id } });
      await prisma.user.deleteMany({ where: { id: { in: [userId, organizerId] } } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
      await prisma.verification.deleteMany({
        where: { id: { in: [`${TAG}-mcp-access-other`] } },
      });
    });

    it("rechaza el borrado si es único owner de una organización con más miembros (SOLE_ORG_OWNER)", async () => {
      const userId = `${TAG}-owner`;
      const otherUserId = `${TAG}-othermember`;
      const email = `${TAG}-owner@test.local`;
      await prisma.user.create({ data: { id: userId, name: "Owner", email } });
      await prisma.user.create({
        data: { id: otherUserId, name: "Otro", email: `${TAG}-othermember@test.local` },
      });
      const orgId = `${TAG}-owned-org`;
      await prisma.organization.create({ data: { id: orgId, name: TAG, slug: `${TAG}-owned-slug` } });
      await prisma.member.create({
        data: { id: `${TAG}-owner-member`, organizationId: orgId, userId, role: "owner" },
      });
      await prisma.member.create({
        data: { id: `${TAG}-owner-other-member`, organizationId: orgId, userId: otherUserId, role: "member" },
      });

      const store = createPrismaUserDataRightsStore(prisma, deps);
      await expect(store.anonymizeAccount(userId, new Date())).rejects.toMatchObject({
        code: "SOLE_ORG_OWNER",
      });

      // Nada se ha tocado: el usuario sigue igual, la membresía sigue viva.
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.email).toBe(email);
      expect(
        await prisma.member.findUnique({ where: { id: `${TAG}-owner-member` } }),
      ).not.toBeNull();

      await prisma.member.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
      await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    });
  },
);
