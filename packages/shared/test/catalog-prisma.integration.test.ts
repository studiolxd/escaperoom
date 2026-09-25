import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client";
import {
  ANONYMOUS_ACTOR,
  createCatalogService,
  createInMemoryRoomPackageRepository,
  createPrismaPublishedRoomListing,
  createPrismaReviewStore,
  createReviewService,
  type Actor,
  type CatalogListInput,
} from "../src/services";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:reset
//   pnpm --filter @escaperoom/shared test catalog-prisma
//
// Comprueba que el SQL de `createPrismaPublishedRoomListing` (filtros,
// `languages @>`, orden, paginación, rating) y el upsert atómico de reseñas se
// comportan igual que las implementaciones en memoria. Los datos llevan un
// marcador único en el título y se filtran con `q`, así que conviven con lo
// que ya haya en la base de datos.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { meta: Record<string, unknown> };

const TAG = `it53${randomUUID().slice(0, 8)}`;
const actor = (userId: string): Actor => ({ userId, organizationId: null, role: "member" });

describe.skipIf(!process.env.DATABASE_URL)(
  "catálogo y reseñas sobre Postgres (integración)",
  () => {
    let prisma: PrismaClient;
    const userIds = { autor: `${TAG}-autor`, ana: `${TAG}-ana`, bruno: `${TAG}-bruno` };
    const roomIds: Record<string, string> = {};
    const versionIds: Record<string, string> = {};

    async function seedRoom(spec: {
      key: string;
      languages: string[];
      difficulty: number;
      players: [number, number];
      priceCents: number | null;
      day: number;
      status?: "published" | "draft";
    }) {
      const title = `${TAG} ${spec.key}`;
      const room = await prisma.room.create({
        data: {
          authorId: userIds.autor,
          title,
          status: spec.status ?? "published",
          priceCents: spec.priceCents,
        },
      });
      const version = await prisma.roomVersion.create({
        data: {
          roomId: room.id,
          semver: "1.0.0",
          assetsHash: "sha256:test",
          publishedBy: userIds.autor,
          publishedAt: new Date(Date.UTC(2026, 0, spec.day)),
          package: {
            ...fixture,
            meta: {
              ...fixture.meta,
              title,
              languages: spec.languages,
              defaultLanguage: spec.languages[0],
              difficulty: spec.difficulty,
              players: { min: spec.players[0], max: spec.players[1] },
            },
          } as object,
        },
      });
      roomIds[spec.key] = room.id;
      versionIds[spec.key] = version.id;
    }

    beforeAll(async () => {
      prisma = new PrismaClient();
      await prisma.user.createMany({
        data: Object.entries(userIds).map(([name, id]) => ({
          id,
          name,
          email: `${id}@test.local`,
        })),
      });
      await seedRoom({
        key: "cripta",
        languages: ["es", "en"],
        difficulty: 1,
        players: [1, 2],
        priceCents: null,
        day: 1,
      });
      await seedRoom({
        key: "castillo",
        languages: ["es"],
        difficulty: 2,
        players: [2, 6],
        priceCents: 499,
        day: 2,
      });
      await seedRoom({
        key: "lab",
        languages: ["en", "fr"],
        difficulty: 3,
        players: [3, 5],
        priceCents: 999,
        day: 3,
      });
      await seedRoom({
        key: "nocturno",
        languages: ["es", "en"],
        difficulty: 2,
        players: [1, 4],
        priceCents: 299,
        day: 4,
      });
      await seedRoom({
        key: "mansion",
        languages: ["es", "en", "fr"],
        difficulty: 3,
        players: [2, 4],
        priceCents: 1500,
        day: 5,
      });
      await seedRoom({
        key: "borrador",
        languages: ["es"],
        difficulty: 2,
        players: [1, 4],
        priceCents: 0,
        day: 6,
        status: "draft",
      });
      // Ana compró el castillo; Bruno jugó el castillo en un evento.
      await prisma.purchase.create({
        data: {
          userId: userIds.ana,
          purchaseType: "room",
          roomVersionId: versionIds.castillo,
          amountCents: 0,
          status: "succeeded",
        },
      });
      const event = await prisma.event.create({
        data: {
          organizerId: userIds.autor,
          roomVersionId: versionIds.castillo!,
          title: TAG,
          pricingSnapshot: {},
          playersPurchased: 4,
        },
      });
      const session = await prisma.gameSession.create({
        data: { eventId: event.id, name: "s1", capacity: 4 },
      });
      await prisma.progressEvent.create({
        data: {
          sessionId: session.id,
          playerId: userIds.bruno,
          puzzleId: "p1",
          eventKind: "solved",
        },
      });
    });

    afterAll(async () => {
      if (!prisma) return;
      const ids = Object.values(roomIds);
      const users = Object.values(userIds);
      await prisma.review.deleteMany({ where: { roomId: { in: ids } } });
      await prisma.progressEvent.deleteMany({ where: { playerId: { in: users } } });
      await prisma.gameSession.deleteMany({ where: { event: { title: TAG } } });
      await prisma.event.deleteMany({ where: { title: TAG } });
      await prisma.purchase.deleteMany({ where: { userId: { in: users } } });
      await prisma.roomVersion.deleteMany({ where: { roomId: { in: ids } } });
      await prisma.room.deleteMany({ where: { id: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    });

    const catalog = () =>
      createCatalogService({
        rooms: createInMemoryRoomPackageRepository(fixture),
        listing: createPrismaPublishedRoomListing(prisma),
      });
    const keyOf = (id: string) => Object.entries(roomIds).find(([, v]) => v === id)?.[0];
    const list = async (input: CatalogListInput = {}) =>
      (await catalog().listRooms(ANONYMOUS_ACTOR, { q: TAG, ...input })).items.map((r) =>
        keyOf(r.id),
      );

    it("filtros combinados en SQL (incluido languages @>)", async () => {
      expect(await list()).toEqual(["mansion", "nocturno", "lab", "castillo", "cripta"]);
      expect(await list({ language: "es", difficulty: "2" })).toEqual(["nocturno", "castillo"]);
      expect(await list({ language: "en,fr" })).toEqual(["mansion", "lab"]);
      expect(await list({ language: "en", players: "3" })).toEqual(["mansion", "nocturno", "lab"]);
      expect(await list({ language: "es", maxPrice: "500" })).toEqual([
        "nocturno",
        "castillo",
        "cripta",
      ]);
      expect(await list({ difficulty: "2,3", players: 5 })).toEqual(["lab", "castillo"]);
      expect(await list({ q: `${TAG} NOCT` })).toEqual(["nocturno"]);
      expect(await list({ sort: "price_asc" })).toEqual([
        "cripta",
        "nocturno",
        "castillo",
        "lab",
        "mansion",
      ]);
    });

    it("paginación por cursor", async () => {
      const first = await catalog().listRooms(ANONYMOUS_ACTOR, { q: TAG, limit: 3 });
      const second = await catalog().listRooms(ANONYMOUS_ACTOR, {
        q: TAG,
        limit: 3,
        cursor: first.nextCursor,
      });
      expect([...first.items, ...second.items].map((r) => keyOf(r.id))).toEqual([
        "mansion",
        "nocturno",
        "lab",
        "castillo",
        "cripta",
      ]);
      expect(second.nextCursor).toBeNull();
    });

    it("upsert de reseña atómico, elegibilidad real y rating en listado/detalle", async () => {
      const reviews = createReviewService({ store: createPrismaReviewStore(prisma) });
      const roomId = roomIds.castillo!;

      await expect(
        reviews.upsertReview(actor(userIds.autor), roomId, { rating: 5 }),
      ).rejects.toMatchObject({ code: "REVIEW_NOT_ALLOWED" });
      await expect(
        reviews.upsertReview(actor(userIds.ana), roomIds.lab!, { rating: 5 }),
      ).rejects.toMatchObject({ code: "REVIEW_NOT_ALLOWED" });

      const created = await reviews.upsertReview(actor(userIds.ana), roomId, {
        rating: 5,
        text: "Genial",
      });
      expect(created).toMatchObject({ created: true, ratingAvg: 5, ratingCount: 1 });
      expect(created.review.authorDisplayName).toBe("ana");
      const edited = await reviews.upsertReview(actor(userIds.ana), roomId, { rating: 4 });
      expect(edited).toMatchObject({ created: false, ratingAvg: 4, ratingCount: 1 });
      expect(edited.review.id).toBe(created.review.id);
      const bruno = await reviews.upsertReview(actor(userIds.bruno), roomId, { rating: 3 });
      expect(bruno).toMatchObject({ created: true, ratingAvg: 3.5, ratingCount: 2 });
      expect(await prisma.review.count({ where: { roomId } })).toBe(2);

      const listed = await reviews.listReviews(ANONYMOUS_ACTOR, roomId);
      expect(listed.items.map((r) => r.authorDisplayName)).toEqual(["bruno", "ana"]);

      const detail = await catalog().getRoom(ANONYMOUS_ACTOR, roomId);
      expect(detail).toMatchObject({
        ratingAvg: 3.5,
        ratingCount: 2,
        priceCents: 499,
        currency: "EUR",
        authorDisplayName: "autor",
        languages: ["es"],
      });
      expect(await list({ sort: "rating" })).toEqual([
        "castillo",
        "mansion",
        "nocturno",
        "lab",
        "cripta",
      ]);
      await expect(catalog().getRoom(ANONYMOUS_ACTOR, roomIds.borrador!)).rejects.toMatchObject({
        code: "ROOM_NOT_FOUND",
      });
      await expect(catalog().getRoom(ANONYMOUS_ACTOR, "no-es-uuid")).rejects.toMatchObject({
        code: "ROOM_NOT_FOUND",
      });
    });

    it("medios puntos: se guardan en escala doblada (2-10) y la media sale ya dividida", async () => {
      const reviews = createReviewService({ store: createPrismaReviewStore(prisma) });
      const roomId = roomIds.castillo!;

      // Continúa del test anterior: ana (rating 4) y bruno (rating 3) ya
      // reseñaron el castillo. Ana pasa a un medio punto.
      const edited = await reviews.upsertReview(actor(userIds.ana), roomId, { rating: 4.5 });
      expect(edited).toMatchObject({ created: false, ratingAvg: 3.8, ratingCount: 2 });
      expect(edited.review.rating).toBe(4.5);

      const row = await prisma.review.findUniqueOrThrow({
        where: { userId_roomId: { userId: userIds.ana, roomId } },
        select: { rating: true },
      });
      expect(row.rating).toBe(9);

      const detail = await catalog().getRoom(ANONYMOUS_ACTOR, roomId);
      expect(detail).toMatchObject({ ratingAvg: 3.8, ratingCount: 2 });
    });
  },
);
