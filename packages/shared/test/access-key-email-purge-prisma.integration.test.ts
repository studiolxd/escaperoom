import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client";
import { createPrismaAccessKeyEmailPurgeStore } from "../src/services/access-key-email-purge-prisma-store";
import { hashPurgedEmail, isPurgedEmail } from "../src/services/access-key-email-purge";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:reset
//   pnpm --filter @escaperoom/shared test access-key-email-purge-prisma
//
// Comprueba `createPrismaAccessKeyEmailPurgeStore` contra el esquema real: el
// join `accessKey` → `gameSession` que decide si "el evento terminó" (todas
// las sesiones `ended`/`aborted`), los dos plazos por audiencia y la
// idempotencia del hash con pgcrypto.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const TAG = `itpurge${randomUUID().slice(0, 8)}`;
const SECRET = "test-secret-purga";
const NOW = new Date();

describe.skipIf(!process.env.DATABASE_URL)(
  "purga de emails de accessKey sobre Postgres (integración)",
  () => {
    let prisma: PrismaClient;
    const organizerId = `${TAG}-org`;
    let roomId = "";
    let versionId = "";
    const eventIds: string[] = [];
    const sessionIds: string[] = [];

    async function makeEvent(opts: {
      audience: "general" | "educational";
      sessions: Array<{ status: "pending" | "ended" | "aborted"; endedAt: Date | null }>;
      createdAt?: Date;
    }) {
      const event = await prisma.event.create({
        data: {
          organizerId,
          roomVersionId: versionId,
          title: TAG,
          audience: opts.audience,
          status: "active",
          pricingSnapshot: {},
          playersPurchased: 8,
          ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
        },
      });
      eventIds.push(event.id);
      for (const s of opts.sessions) {
        const session = await prisma.gameSession.create({
          data: { eventId: event.id, name: "Sesión", capacity: 4, status: s.status, endedAt: s.endedAt },
        });
        sessionIds.push(session.id);
      }
      return event;
    }

    async function makeKey(eventId: string, code: string, email: string | null) {
      await prisma.accessKey.create({
        data: {
          code,
          eventId,
          keyType: "individual",
          status: "used",
          singleUse: true,
          seats: 1,
          redeemedCount: 1,
          email,
        },
      });
      return code;
    }

    beforeAll(async () => {
      prisma = new PrismaClient();
      await prisma.user.create({ data: { id: organizerId, name: organizerId, email: `${organizerId}@test.local` } });
      const room = await prisma.room.create({ data: { authorId: organizerId, title: TAG, status: "published" } });
      const version = await prisma.roomVersion.create({
        data: {
          roomId: room.id,
          semver: "1.0.0",
          assetsHash: "sha256:test",
          publishedBy: organizerId,
          package: { meta: { id: room.id, version: "1.0.0" } } as object,
        },
      });
      roomId = room.id;
      versionId = version.id;
    });

    afterAll(async () => {
      if (!prisma) return;
      await prisma.accessKey.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.gameSession.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
      await prisma.roomVersion.deleteMany({ where: { id: versionId } });
      await prisma.room.deleteMany({ where: { id: roomId } });
      await prisma.user.deleteMany({ where: { id: organizerId } });
      await prisma.$disconnect();
    });

    it("purga solo eventos generales terminados hace más de 12 meses, evento educativo aparte", async () => {
      const oldEnded = new Date("2020-01-01T00:00:00Z");
      const generalDone = await makeEvent({
        audience: "general",
        sessions: [{ status: "ended", endedAt: oldEnded }],
      });
      const generalStillOpen = await makeEvent({
        audience: "general",
        sessions: [
          { status: "ended", endedAt: oldEnded },
          { status: "pending", endedAt: null },
        ],
      });
      const educationalDone = await makeEvent({
        audience: "educational",
        sessions: [{ status: "aborted", endedAt: oldEnded }],
      });
      const generalRecent = await makeEvent({
        audience: "general",
        sessions: [{ status: "ended", endedAt: new Date() }],
      });

      const kDone = await makeKey(generalDone.id, `${TAG}-DONE`, "alumna@centro.example");
      const kOpen = await makeKey(generalStillOpen.id, `${TAG}-OPEN`, "otro@centro.example");
      const kEdu = await makeKey(educationalDone.id, `${TAG}-EDU`, "menor@centro.example");
      const kRecent = await makeKey(generalRecent.id, `${TAG}-RECENT`, "reciente@centro.example");

      const store = createPrismaAccessKeyEmailPurgeStore(prisma);
      const result = await store.purgeExpiredEmails(NOW, SECRET);

      expect(result.general).toBeGreaterThanOrEqual(1);
      expect(result.educational).toBeGreaterThanOrEqual(1);

      const rows = await prisma.accessKey.findMany({
        where: { code: { in: [kDone, kOpen, kEdu, kRecent] } },
      });
      const byCode = Object.fromEntries(rows.map((r) => [r.code, r.email]));

      expect(isPurgedEmail(byCode[kDone]!)).toBe(true);
      expect(isPurgedEmail(byCode[kEdu]!)).toBe(true);
      // Evento con una sesión aún pendiente: no cuenta como terminado.
      expect(byCode[kOpen]).toBe("otro@centro.example");
      // El plazo general (12 meses) aún no ha pasado desde hoy.
      expect(byCode[kRecent]).toBe("reciente@centro.example");

      // E-3: el hash de pgcrypto (clave derivada pasada desde Node) es
      // exactamente comparable con el que calcula `hashPurgedEmail` en Node.
      expect(byCode[kDone]).toBe(hashPurgedEmail("alumna@centro.example", SECRET));
      expect(byCode[kEdu]).toBe(hashPurgedEmail("menor@centro.example", SECRET));
    });

    it("E-16: un evento nunca jugado (sin sesiones, o con una pending que nunca se resuelve) purga por event.createdAt", async () => {
      const oldCreatedAt = new Date("2019-01-01T00:00:00Z");
      const neverPlayed = await makeEvent({ audience: "general", sessions: [], createdAt: oldCreatedAt });
      const stuckPending = await makeEvent({
        audience: "general",
        sessions: [{ status: "pending", endedAt: null }],
        createdAt: oldCreatedAt,
      });
      const neverPlayedRecent = await makeEvent({ audience: "general", sessions: [] });

      const kNever = await makeKey(neverPlayed.id, `${TAG}-NEVER`, "nunca@centro.example");
      const kStuck = await makeKey(stuckPending.id, `${TAG}-STUCK`, "atascado@centro.example");
      const kNeverRecent = await makeKey(neverPlayedRecent.id, `${TAG}-NEVER-RECENT`, "reciente-nunca@centro.example");

      const store = createPrismaAccessKeyEmailPurgeStore(prisma);
      await store.purgeExpiredEmails(NOW, SECRET);

      const rows = await prisma.accessKey.findMany({
        where: { code: { in: [kNever, kStuck, kNeverRecent] } },
      });
      const byCode = Object.fromEntries(rows.map((r) => [r.code, r.email]));

      expect(isPurgedEmail(byCode[kNever]!)).toBe(true);
      expect(isPurgedEmail(byCode[kStuck]!)).toBe(true);
      // Evento nunca jugado pero reciente: el plazo aún no ha pasado desde su creación.
      expect(byCode[kNeverRecent]).toBe("reciente-nunca@centro.example");
    });

    it("es idempotente: repetir la pasada no vuelve a hashear un email ya purgado", async () => {
      const event = await makeEvent({
        audience: "general",
        sessions: [{ status: "ended", endedAt: new Date("2019-01-01T00:00:00Z") }],
      });
      const code = await makeKey(event.id, `${TAG}-IDEMP`, "idempotente@centro.example");

      const store = createPrismaAccessKeyEmailPurgeStore(prisma);
      await store.purgeExpiredEmails(NOW, SECRET);
      const first = (await prisma.accessKey.findUniqueOrThrow({ where: { code } })).email!;
      expect(isPurgedEmail(first)).toBe(true);

      await store.purgeExpiredEmails(NOW, SECRET);
      const second = (await prisma.accessKey.findUniqueOrThrow({ where: { code } })).email!;
      expect(second).toBe(first);
    });
  },
);
