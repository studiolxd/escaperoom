import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client";
import { createModerationService, createPrismaModerationStore, type Actor } from "../src/services";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:migrate
//   pnpm --filter @escaperoom/shared test moderation-prisma
//
// Comprueba `createPrismaModerationStore` contra la migración 0016: los CHECK
// de `contentReport` (destino, reporter por fuente), la despublicación y
// restauración de la sala en una transacción, reseñas ocultas, strikes y
// apelaciones, y el muestreo de versiones sin muestrear.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const TAG = `it61${randomUUID().slice(0, 8)}`;
const actor = (userId: string): Actor => ({ userId, organizationId: null, role: "member" });

describe.skipIf(!process.env.DATABASE_URL)("moderación sobre Postgres (integración)", () => {
  let prisma: PrismaClient;
  const ids = { autora: `${TAG}-autora`, jugadora: `${TAG}-jugadora`, mod: `${TAG}-mod` };
  let roomId = "";
  let versionId = "";
  let reviewId = "";

  const service = () => createModerationService({ store: createPrismaModerationStore(prisma) });

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.createMany({
      data: Object.entries(ids).map(([name, id]) => ({
        id,
        name,
        email: `${id}@test.local`,
        isModerator: name === "mod",
      })),
    });
    const room = await prisma.room.create({
      data: { authorId: ids.autora, title: TAG, status: "published" },
    });
    const version = await prisma.roomVersion.create({
      data: {
        roomId: room.id,
        semver: "1.0.0",
        assetsHash: "sha256:test",
        publishedBy: ids.autora,
        package: { meta: { id: room.id } },
      },
    });
    const review = await prisma.review.create({
      data: { userId: ids.jugadora, roomId: room.id, rating: 2, text: "reseña" },
    });
    roomId = room.id;
    versionId = version.id;
    reviewId = review.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    const users = Object.values(ids);
    await prisma.moderationAppeal.deleteMany({ where: { creatorId: { in: users } } });
    await prisma.moderationStrike.deleteMany({ where: { userId: { in: users } } });
    await prisma.contentReport.deleteMany({ where: { roomId } });
    await prisma.review.deleteMany({ where: { roomId } });
    await prisma.roomVersion.deleteMany({ where: { roomId } });
    await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it("reporte crítico → entra en cola con prioridad máxima sin tocar la sala ni la cuenta (A-3, revisado 2026-09-25)", async () => {
    const moderation = service();
    const { report } = await moderation.report(actor(ids.jugadora), {
      targetType: "room",
      targetId: roomId,
      category: "minor_safety",
      reason: "Contenido inapropiado",
    });
    expect(report).toMatchObject({
      severity: "critical",
      roomVersionId: versionId,
      targetUserId: ids.autora,
      actionTaken: null,
      autoActioned: false,
      roomStatusBefore: null,
    });
    expect((await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).status).toBe(
      "published",
    );
    expect(await moderation.publishBlocker(ids.autora)).toBeNull();

    const queue = await moderation.listQueue(actor(ids.mod));
    expect(queue.some((q) => q.report.id === report.id)).toBe(true);

    // El moderador descarta: la sala nunca se tocó, así que no hay nada que
    // restaurar (a diferencia del comportamiento previo a esta revisión).
    await moderation.resolveReport(actor(ids.mod), report.id, { status: "dismissed" });
    expect((await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).status).toBe(
      "published",
    );
  });

  it("reseña reportada: el moderador la oculta al confirmar; strikes, suspensión y apelación estimada que la levanta", async () => {
    const moderation = service();
    const hidden = await moderation.report(actor(ids.autora), {
      targetType: "review",
      targetId: reviewId,
      category: "harassment",
      reason: "Datos de un menor",
    });
    // A-3 (revisado 2026-09-25): sin revisar, la reseña sigue visible.
    expect((await prisma.review.findUniqueOrThrow({ where: { id: reviewId } })).hiddenAt).toBe(
      null,
    );
    await moderation.resolveReport(actor(ids.mod), hidden.report.id, { status: "actioned" });
    expect((await prisma.review.findUniqueOrThrow({ where: { id: reviewId } })).hiddenAt).not.toBe(
      null,
    );

    for (const category of ["spam", "quality"]) {
      const { report } = await moderation.report(actor(ids.jugadora), {
        targetType: "room",
        targetId: roomId,
        category,
        reason: "Motivo",
      });
      await moderation.resolveReport(actor(ids.mod), report.id, { status: "actioned" });
    }
    expect((await moderation.standing(actor(ids.autora))).status).toBe("suspended");
    const strikes = await prisma.moderationStrike.findMany({ where: { userId: ids.autora } });
    expect(strikes.map((s) => s.consequence).sort()).toEqual(["suspension", "warning"]);

    const appeal = await moderation.appealAccount(actor(ids.autora), {
      reason: "La sala ya está corregida",
    });
    const res = await moderation.resolveAppeal(actor(ids.mod), appeal.id, {
      decision: "overturned",
    });
    expect(res.standing.status).toBe("warned");
    const row = await prisma.moderationAppeal.findUniqueOrThrow({ where: { id: appeal.id } });
    expect(row).toMatchObject({ status: "overturned", reviewedBy: ids.mod });
  });

  it("muestreo: la versión reciente entra una sola vez", async () => {
    const store = createPrismaModerationStore(prisma);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const before = await store.listUnsampledVersions(since, 1000);
    expect(before.some((v) => v.versionId === versionId)).toBe(true);
    await service().sampleRecentlyPublished({ rate: 1 });
    const after = await store.listUnsampledVersions(since, 1000);
    expect(after.some((v) => v.versionId === versionId)).toBe(false);
  });

  it("el CHECK de 0016 exige reporter en los reportes de usuario", async () => {
    await expect(
      prisma.contentReport.create({
        data: { roomId, targetType: "room", reason: "x", source: "user_report" },
      }),
    ).rejects.toThrow();
  });
});
