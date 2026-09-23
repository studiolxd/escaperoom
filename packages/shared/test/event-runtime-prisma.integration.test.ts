import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client";
import type { RoomPackage } from "../src/schemas";
import { createPrismaEventRuntimeStore } from "../src/services";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:reset
//   pnpm --filter @escaperoom/shared test event-runtime-prisma
//
// Comprueba `createPrismaEventRuntimeStore` (ticket 5.12) contra el esquema
// real (0015): el paquete publicado del evento, los hitos en `progressEvent`
// con sus CHECK, el estado de `gameSession`, `group.completedAt` y la caducidad
// `on_group_complete` acotada a los grupos que jugaron, y la reconstrucción
// del progreso que lee el panel.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
    ),
    "utf8",
  ),
) as RoomPackage;

const TAG = `it512${randomUUID().slice(0, 8)}`;
const T = Date.parse("2026-06-01T10:00:00Z");

describe.skipIf(!process.env.DATABASE_URL)(
  "runtime de eventos sobre Postgres (integración)",
  () => {
    let prisma: PrismaClient;
    const organizerId = `${TAG}-profe`;
    const playerId = `${TAG}-alumna`;
    let roomId = "";
    let versionId = "";
    let eventId = "";
    let sessionIds: string[] = [];
    let groupIds: string[] = [];

    beforeAll(async () => {
      prisma = new PrismaClient();
      await prisma.user.createMany({
        data: [organizerId, playerId].map((id) => ({ id, name: id, email: `${id}@test.local` })),
      });
      const room = await prisma.room.create({
        data: { authorId: organizerId, title: TAG, status: "published" },
      });
      const version = await prisma.roomVersion.create({
        data: {
          roomId: room.id,
          semver: "1.1.0",
          assetsHash: "sha256:test",
          publishedBy: organizerId,
          package: {
            ...fixture,
            meta: { ...fixture.meta, id: room.id, version: "1.1.0" },
          } as object,
        },
      });
      const event = await prisma.event.create({
        data: {
          organizerId,
          roomVersionId: version.id,
          title: TAG,
          status: "active",
          expiryRules: [{ type: "on_group_complete" }],
          pricingSnapshot: {},
          playersPurchased: 8,
        },
      });
      const sessions = await Promise.all(
        ["Sesión 1", "Sesión 2"].map((name) =>
          prisma.gameSession.create({ data: { eventId: event.id, name, capacity: 4 } }),
        ),
      );
      const groups = await Promise.all(
        ["Azul", "Rojo"].map((name) =>
          prisma.group.create({ data: { sessionId: sessions[0]!.id, name } }),
        ),
      );
      await prisma.accessKey.createMany({
        data: groups.map((group, index) => ({
          code: `${TAG}-${index}`.toUpperCase(),
          eventId: event.id,
          sessionId: sessions[0]!.id,
          groupId: group.id,
          keyType: "group" as const,
          status: "active" as const,
          singleUse: false,
          seats: 2,
          redeemedCount: 1,
        })),
      });
      roomId = room.id;
      versionId = version.id;
      eventId = event.id;
      sessionIds = sessions.map((s) => s.id);
      groupIds = groups.map((g) => g.id);
    });

    afterAll(async () => {
      if (!prisma) return;
      await prisma.progressEvent.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.accessKey.deleteMany({ where: { eventId } });
      await prisma.group.deleteMany({ where: { id: { in: groupIds } } });
      await prisma.gameSession.deleteMany({ where: { eventId } });
      await prisma.event.deleteMany({ where: { id: eventId } });
      await prisma.roomVersion.deleteMany({ where: { id: versionId } });
      await prisma.room.deleteMany({ where: { id: roomId } });
      await prisma.user.deleteMany({ where: { id: { in: [organizerId, playerId] } } });
      await prisma.$disconnect();
    });

    it("carga el paquete congelado de la versión del evento (solo si está activo)", async () => {
      const store = createPrismaEventRuntimeStore(prisma);
      const loaded = await store.loadEventPackage(eventId);
      expect(loaded).toMatchObject({ eventId, roomVersionId: versionId });
      expect(loaded!.roomPackage.meta).toMatchObject({ id: roomId, version: "1.1.0" });

      await prisma.event.update({ where: { id: eventId }, data: { status: "closed" } });
      await expect(store.loadEventPackage(eventId)).resolves.toBeNull();
      await prisma.event.update({ where: { id: eventId }, data: { status: "active" } });
      await expect(store.loadEventPackage(randomUUID())).resolves.toBeNull();
    });

    it("persiste los hitos, cierra la sesión y el grupo, caduca sus claves y reconstruye el progreso", async () => {
      const store = createPrismaEventRuntimeStore(prisma);
      const [s1, s2] = sessionIds as [string, string];
      const [azul, rojo] = groupIds as [string, string];
      const clock = (seconds: number, hintsUsed = 0) => ({
        at: T + seconds * 1000,
        elapsedMs: seconds * 1000,
        hintsUsed,
      });

      await store.recordMilestone(s1, { kind: "game_started", at: T, roomId: "room-1" });
      await store.recordMilestone(s1, {
        kind: "solved",
        puzzleId: "p-llave-cuadro",
        groupId: azul,
        userId: playerId,
        ...clock(30),
      });
      await store.recordMilestone(s1, {
        kind: "hint_used",
        puzzleId: "p-candado-arca",
        groupId: azul,
        userId: null,
        ...clock(40, 1),
      });
      await store.recordMilestone(s1, {
        kind: "door_opened",
        objectId: "puerta-bodega",
        groupId: null,
        userId: null,
        ...clock(50, 1),
      });
      await store.recordMilestone(s2, { kind: "game_started", at: T + 5000, roomId: "room-2" });
      await store.recordMilestone(s1, {
        kind: "game_ended",
        result: "victory",
        groupIds: [azul],
        ...clock(60, 1),
      });

      const rows = await prisma.progressEvent.findMany({
        where: { sessionId: s1 },
        orderBy: { id: "asc" },
      });
      expect(rows.map((r) => [r.eventKind, r.puzzleId, r.objectId, r.result])).toEqual([
        ["game_started", null, null, null],
        ["solved", "p-llave-cuadro", null, null],
        ["hint_used", "p-candado-arca", null, null],
        ["door_opened", null, "puerta-bodega", null],
        ["game_ended", null, null, "victory"],
      ]);
      expect(rows[1]).toMatchObject({ groupId: azul, playerId, durationMs: 30_000 });
      expect(rows[1]!.createdAt.getTime()).toBe(T + 30_000);

      const [session1, session2] = await Promise.all(
        [s1, s2].map((id) => prisma.gameSession.findUniqueOrThrow({ where: { id } })),
      );
      expect(session1).toMatchObject({ status: "ended", colyseusRoomId: "room-1" });
      expect(session1!.startedAt?.getTime()).toBe(T);
      expect(session1!.endedAt?.getTime()).toBe(T + 60_000);
      expect(session2).toMatchObject({ status: "in_progress", endedAt: null });

      const groups = await prisma.group.findMany({
        where: { id: { in: groupIds } },
        select: { id: true, completedAt: true },
      });
      const completed = Object.fromEntries(groups.map((g) => [g.id, g.completedAt?.getTime()]));
      expect(completed).toEqual({ [azul]: T + 60_000, [rojo]: undefined });
      const keys = await prisma.accessKey.findMany({
        where: { eventId },
        select: { groupId: true, status: true },
      });
      expect(Object.fromEntries(keys.map((k) => [k.groupId, k.status]))).toEqual({
        [azul]: "expired",
        [rojo]: "active",
      });

      expect(await store.forEvent(eventId)).toEqual([
        {
          sessionId: s1,
          eventId,
          phase: "ended",
          result: "victory",
          puzzlesSolved: 1,
          puzzlesTotal: fixture.puzzles.length,
          hintsUsed: 1,
          startedAt: T,
          endedAt: T + 60_000,
          elapsedMs: 60_000,
          updatedAt: T + 60_000,
        },
        expect.objectContaining({ sessionId: s2, phase: "playing", puzzlesSolved: 0 }),
      ]);
    });

    it("los CHECK de 0015: un hito de puzzle exige `puzzleId` y el resultado es canónico", async () => {
      await expect(
        prisma.progressEvent.create({ data: { sessionId: sessionIds[1]!, eventKind: "solved" } }),
      ).rejects.toThrow();
      await expect(
        prisma.progressEvent.create({
          data: { sessionId: sessionIds[1]!, eventKind: "game_ended", result: "ganaron" },
        }),
      ).rejects.toThrow();
    });
  },
);
