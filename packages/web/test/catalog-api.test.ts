import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ANONYMOUS_ACTOR,
  createCatalogService,
  createInMemoryPublishedRoomListing,
  createInMemoryReviewStore,
  createInMemoryRoomPackageRepository,
  createReviewService,
  type Actor,
  type CatalogRoom,
  type InMemoryCatalogRoom,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createRoomReviewsHandlers } from "../src/server/rest/room-reviews";
import { createRoomDetailHandler, createRoomsListHandler } from "../src/server/rest/rooms-list";
import { appRouter } from "../src/server/routers/_app";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { meta: Record<string, unknown> };

function room(
  roomId: string,
  opts: {
    languages: string[];
    difficulty: 1 | 2 | 3;
    players: [number, number];
    priceCents: number | null;
    day: number;
    status?: InMemoryCatalogRoom["status"];
  },
): InMemoryCatalogRoom {
  return {
    roomId,
    status: opts.status ?? "published",
    authorDisplayName: "Autora",
    priceCents: opts.priceCents,
    versions: [
      {
        id: `v-${roomId}`,
        semver: "1.0.0",
        publishedAt: new Date(Date.UTC(2026, 0, opts.day)),
        package: {
          ...fixture,
          meta: {
            ...fixture.meta,
            title: `Sala ${roomId}`,
            languages: opts.languages,
            defaultLanguage: opts.languages[0],
            difficulty: opts.difficulty,
            players: { min: opts.players[0], max: opts.players[1] },
          },
        },
      },
    ],
  };
}

const ROOMS = [
  room("a", { languages: ["es"], difficulty: 1, players: [1, 2], priceCents: null, day: 1 }),
  room("b", { languages: ["es", "en"], difficulty: 2, players: [2, 6], priceCents: 499, day: 2 }),
  room("c", { languages: ["en"], difficulty: 2, players: [3, 5], priceCents: 999, day: 3 }),
  room("d", { languages: ["es", "en"], difficulty: 3, players: [1, 4], priceCents: 299, day: 4 }),
  room("x", {
    languages: ["es"],
    difficulty: 2,
    players: [1, 4],
    priceCents: 0,
    day: 5,
    status: "draft",
  }),
];

const member = (userId: string): Actor => ({ userId, organizationId: null, role: "member" });

function setup() {
  const store = createInMemoryReviewStore({
    rooms: ROOMS.filter((r) => r.status === "published").map((r) => ({
      roomId: r.roomId,
      authorId: "autora",
    })),
    eligible: ["ana:b", "bruno:b"],
    users: { ana: "Ana", bruno: "Bruno" },
  });
  const catalog = createCatalogService({
    rooms: createInMemoryRoomPackageRepository(fixture),
    listing: createInMemoryPublishedRoomListing(ROOMS, { ratings: store.ratingStats }),
  });
  const reviews = createReviewService({ store });
  let actor: Actor = ANONYMOUS_ACTOR;
  const resolveActor = async () => actor;
  return {
    catalog,
    reviews,
    as(next: Actor) {
      actor = next;
    },
    list: createRoomsListHandler({ catalog, resolveActor }),
    detail: createRoomDetailHandler({ catalog, resolveActor }),
    reviewHandlers: createRoomReviewsHandlers({ reviews, resolveActor }),
    caller: (callerActor: Actor) =>
      appRouter.createCaller({ actor: callerActor, catalog, reviews }),
  };
}

const ctx = (roomId: string) => ({ params: Promise.resolve({ roomId }) });
const json = async (response: Response) => ({
  status: response.status,
  body: (await response.json()) as Record<string, unknown>,
});
const ids = (body: Record<string, unknown>) => (body.items as CatalogRoom[]).map((r) => r.id);

describe("GET /api/rooms — filtros combinables y paginación", () => {
  it("combina idioma (languages @>), dificultad, jugadores y precio", async () => {
    const { list } = setup();
    const get = async (query: string) =>
      json(await list(new Request(`http://localhost/api/rooms${query}`)));

    expect(ids((await get("")).body)).toEqual(["d", "c", "b", "a"]);
    expect(ids((await get("?language=es&language=en")).body)).toEqual(["d", "b"]);
    expect(ids((await get("?language=en&difficulty=2")).body)).toEqual(["c", "b"]);
    expect(ids((await get("?language=es&players=2&maxPrice=499")).body)).toEqual(["d", "b", "a"]);
    expect(ids((await get("?difficulty=2,3&minPrice=300&players=5")).body)).toEqual(["c", "b"]);
    expect(ids((await get("?sort=price_desc&language=es")).body)).toEqual(["b", "d", "a"]);
  });

  it("pagina con { items, nextCursor } y cachea en el edge", async () => {
    const { list } = setup();
    const first = await list(new Request("http://localhost/api/rooms?limit=3"));
    expect(first.headers.get("Cache-Control")).toContain("s-maxage");
    const page1 = (await first.json()) as { items: CatalogRoom[]; nextCursor: string };
    expect(page1.items.map((r) => r.id)).toEqual(["d", "c", "b"]);
    const page2 = await json(
      await list(new Request(`http://localhost/api/rooms?limit=3&cursor=${page1.nextCursor}`)),
    );
    expect(page2.body).toMatchObject({ nextCursor: null });
    expect(ids(page2.body)).toEqual(["a"]);
  });

  it("422 VALIDATION_ERROR con filtros no válidos", async () => {
    const { list } = setup();
    for (const query of ["?difficulty=9", "?minPrice=5&maxPrice=1", "?players=x", "?sort=foo"]) {
      const res = await json(await list(new Request(`http://localhost/api/rooms${query}`)));
      expect(res.status, query).toBe(422);
      expect(res.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    }
  });
});

describe("GET /api/rooms/:roomId — detalle de catálogo", () => {
  it("200 con la forma de specs/13 §3, nunca el package", async () => {
    const { detail } = setup();
    const res = await json(await detail(new Request("http://localhost/api/rooms/b"), ctx("b")));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "b",
      title: "Sala b",
      authorDisplayName: "Autora",
      difficulty: 2,
      estimatedMinutes: 55,
      players: { min: 2, max: 6 },
      languages: ["es", "en"],
      priceCents: 499,
      currency: "EUR",
      saleIndividual: true,
      saleEvents: true,
      licensePriceCents: null,
      ratingAvg: null,
      ratingCount: 0,
      latestVersion: { id: "v-b", semver: "1.0.0" },
    });
    expect(res.body).not.toHaveProperty("package");
  });

  it("404 ROOM_NOT_FOUND para salas fuera de catálogo", async () => {
    const { detail } = setup();
    for (const id of ["x", "nope"]) {
      const res = await json(
        await detail(new Request(`http://localhost/api/rooms/${id}`), ctx(id)),
      );
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: { code: "ROOM_NOT_FOUND" } });
    }
  });
});

describe("/api/rooms/:roomId/reviews", () => {
  const post = (body: unknown) =>
    new Request("http://localhost/api/rooms/b/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("crea (201), edita (200) sin duplicar y actualiza media/recuento del listado", async () => {
    const t = setup();
    t.as(member("ana"));
    const created = await json(
      await t.reviewHandlers.postReview(post({ rating: 5, text: "¡Top!" }), ctx("b")),
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ created: true, ratingAvg: 5, ratingCount: 1 });

    const edited = await json(await t.reviewHandlers.postReview(post({ rating: 3 }), ctx("b")));
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ created: false, ratingAvg: 3, ratingCount: 1 });

    t.as(member("bruno"));
    await t.reviewHandlers.postReview(post({ rating: 4 }), ctx("b"));

    t.as(ANONYMOUS_ACTOR);
    const listed = await json(
      await t.reviewHandlers.getReviews(
        new Request("http://localhost/api/rooms/b/reviews"),
        ctx("b"),
      ),
    );
    expect(listed.body).toMatchObject({ ratingAvg: 3.5, ratingCount: 2, nextCursor: null });
    expect((listed.body.items as unknown[]).length).toBe(2);

    const catalogRow = (
      (await json(await t.list(new Request("http://localhost/api/rooms?language=en&language=es"))))
        .body.items as CatalogRoom[]
    ).find((r) => r.id === "b");
    expect(catalogRow).toMatchObject({ ratingAvg: 3.5, ratingCount: 2 });
  });

  it("401 anónimo, 403 sin haber jugado, 404 sala fuera de catálogo", async () => {
    const t = setup();
    expect((await t.reviewHandlers.postReview(post({ rating: 5 }), ctx("b"))).status).toBe(401);
    t.as(member("carla"));
    const forbidden = await json(await t.reviewHandlers.postReview(post({ rating: 5 }), ctx("b")));
    expect(forbidden).toMatchObject({
      status: 403,
      body: { error: { code: "REVIEW_NOT_ALLOWED" } },
    });
    t.as(member("autora"));
    expect((await t.reviewHandlers.postReview(post({ rating: 5 }), ctx("b"))).status).toBe(403);
    t.as(member("ana"));
    expect((await t.reviewHandlers.postReview(post({ rating: 5 }), ctx("x"))).status).toBe(404);
    expect(
      (
        await t.reviewHandlers.getReviews(
          new Request("http://localhost/api/rooms/x/reviews"),
          ctx("x"),
        )
      ).status,
    ).toBe(404);
  });

  it("400 con cuerpo o valoración no válidos; 422 con lenguaje no permitido", async () => {
    const t = setup();
    t.as(member("ana"));
    expect((await t.reviewHandlers.postReview(post("{no json"), ctx("b"))).status).toBe(400);
    expect((await t.reviewHandlers.postReview(post([1]), ctx("b"))).status).toBe(400);
    expect((await t.reviewHandlers.postReview(post({ rating: 6 }), ctx("b"))).status).toBe(400);
    const rejected = await json(
      await t.reviewHandlers.postReview(post({ rating: 1, text: "Qué gilipollas" }), ctx("b")),
    );
    expect(rejected).toMatchObject({ status: 422, body: { error: { code: "CONTENT_REJECTED" } } });
  });
});

describe("tRPC — mismos servicios que REST", () => {
  it("catalog.listRooms/getRoom devuelven lo mismo que REST", async () => {
    const t = setup();
    const viaRest = await json(
      await t.list(new Request("http://localhost/api/rooms?language=es&difficulty=2,3&limit=1")),
    );
    const viaTrpc = await t
      .caller(ANONYMOUS_ACTOR)
      .catalog.listRooms({ language: "es", difficulty: [2, 3], limit: 1 });
    expect(viaTrpc).toEqual(viaRest.body);
    expect(await t.caller(ANONYMOUS_ACTOR).catalog.getRoom({ roomId: "b" })).toMatchObject({
      id: "b",
    });
    await expect(t.caller(ANONYMOUS_ACTOR).catalog.getRoom({ roomId: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(t.caller(ANONYMOUS_ACTOR).catalog.listRooms({ players: 0 })).rejects.toMatchObject(
      { code: "BAD_REQUEST" },
    );
  });

  it("reviews.upsert/list/viewerState con los códigos de tRPC", async () => {
    const t = setup();
    await expect(
      t.caller(ANONYMOUS_ACTOR).reviews.upsert({ roomId: "b", rating: 5 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      t.caller(member("carla")).reviews.upsert({ roomId: "b", rating: 5 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const res = await t
      .caller(member("ana"))
      .reviews.upsert({ roomId: "b", rating: 4, text: "Bien" });
    expect(res).toMatchObject({ created: true, ratingCount: 1 });
    expect(await t.caller(member("ana")).reviews.viewerState({ roomId: "b" })).toMatchObject({
      canReview: true,
      review: { rating: 4, text: "Bien" },
    });
    expect(await t.caller(ANONYMOUS_ACTOR).reviews.list({ roomId: "b" })).toMatchObject({
      ratingAvg: 4,
      ratingCount: 1,
    });
  });
});
