import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/client";
import { createPrismaClient } from "../src/db";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno (igual que el resto de *.integration.test.ts):
//
//   pnpm infra:up && pnpm dev:env && pnpm db:migrate
//   pnpm --filter @escaperoom/shared test adapter-pg-types
//
// Migración a Prisma 7 (adaptador @prisma/adapter-pg, sin motor de Rust):
// comprueba tipos de columna donde el adaptador `pg` podría comportarse
// distinto al motor anterior — `citext` (accessKey.email) y `timestamptz`
// bajo un TZ de proceso distinto de UTC. El redondeo de BigInt
// (creditAccount.balanceCredits) ya lo cubre credits-prisma.integration.test.ts;
// el esquema no usa ningún campo `Decimal`.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const TAG = `ittypes${randomUUID().slice(0, 8)}`;

describe.skipIf(!process.env.DATABASE_URL)("tipos de columna sobre el adaptador pg (integración)", () => {
  let prisma: PrismaClient;
  const organizerId = `${TAG}-org`;
  let roomId = "";
  let versionId = "";
  let eventId = "";

  beforeAll(async () => {
    prisma = createPrismaClient();
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
    const event = await prisma.event.create({
      data: {
        organizerId,
        roomVersionId: versionId,
        title: TAG,
        audience: "general",
        status: "active",
        pricingSnapshot: {},
        playersPurchased: 8,
      },
    });
    eventId = event.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.accessKey.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.roomVersion.deleteMany({ where: { id: versionId } });
    await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { id: organizerId } });
    await prisma.$disconnect();
  });

  it("`citext` (accessKey.email) compara sin distinguir mayúsculas a través del adaptador", async () => {
    const code = `${TAG}-CITEXT`;
    await prisma.accessKey.create({
      data: { code, eventId, keyType: "individual", status: "generated", email: "Persona@Ejemplo.COM" },
    });

    const byLower = await prisma.accessKey.findFirst({ where: { code, email: "persona@ejemplo.com" } });
    const byUpper = await prisma.accessKey.findFirst({ where: { code, email: "PERSONA@EJEMPLO.COM" } });

    expect(byLower?.code).toBe(code);
    expect(byUpper?.code).toBe(code);
  });

  it("`timestamptz` conserva el instante exacto con TZ de proceso distinto de UTC", async () => {
    // No es un truco de aislamiento: el pool `pg` del adaptador ya está creado
    // (beforeAll), así que este cambio de `process.env.TZ` solo puede afectar
    // cómo esta conexión concreta parsea/serializa fechas — que es justo lo
    // que se quiere comprobar (ninguna suposición oculta sobre UTC).
    const originalTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // Con milisegundos no redondos y un signo de offset "raro" (Postgres
      // no distingue TZ.Timestamptz de un DateTime de JS, siempre en UTC),
      // para que un desajuste de parseo se note.
      const expiresAt = new Date("2027-03-14T04:07:09.123Z");
      const code = `${TAG}-TZ`;
      await prisma.accessKey.create({
        data: { code, eventId, keyType: "individual", status: "generated", expiresAt },
      });

      const row = await prisma.accessKey.findUniqueOrThrow({ where: { code } });

      expect(row.expiresAt?.toISOString()).toBe(expiresAt.toISOString());
      expect(row.expiresAt?.getTime()).toBe(expiresAt.getTime());
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});
