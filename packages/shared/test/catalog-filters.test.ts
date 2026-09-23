import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_ACTOR,
  CatalogError,
  createCatalogService,
  createInMemoryPublishedRoomListing,
  createInMemoryReviewStore,
  createInMemoryRoomPackageRepository,
  escapeLikePattern,
  parseCatalogQuery,
  type CatalogListInput,
  type InMemoryCatalogRoom,
} from "../src/services";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { meta: Record<string, unknown> };

type RoomSpec = {
  id: string;
  title: string;
  languages: string[];
  difficulty: 1 | 2 | 3;
  players: [number, number];
  priceCents: number | null;
  day: number;
};

function room(spec: RoomSpec): InMemoryCatalogRoom {
  return {
    roomId: spec.id,
    status: "published",
    authorDisplayName: `Autor de ${spec.title}`,
    priceCents: spec.priceCents,
    versions: [
      {
        id: `v-${spec.id}`,
        semver: "1.0.0",
        publishedAt: new Date(Date.UTC(2026, 0, spec.day)),
        package: {
          ...fixture,
          meta: {
            ...fixture.meta,
            title: spec.title,
            languages: spec.languages,
            defaultLanguage: spec.languages[0],
            difficulty: spec.difficulty,
            players: { min: spec.players[0], max: spec.players[1] },
          },
        },
      },
    ],
  };
}

// Cinco salas publicadas con combinaciones distintas de idioma, dificultad,
// jugadores y precio (la más reciente es la de mayor `day`).
const ROOMS: InMemoryCatalogRoom[] = [
  room({
    id: "cripta",
    title: "La Cripta",
    languages: ["es", "en"],
    difficulty: 1,
    players: [1, 2],
    priceCents: null,
    day: 1,
  }),
  room({
    id: "castillo",
    title: "El Castillo",
    languages: ["es"],
    difficulty: 2,
    players: [2, 6],
    priceCents: 499,
    day: 2,
  }),
  room({
    id: "lab",
    title: "Laboratorio 50%",
    languages: ["en", "fr"],
    difficulty: 3,
    players: [3, 5],
    priceCents: 999,
    day: 3,
  }),
  room({
    id: "nocturno",
    title: "Castillo Nocturno",
    languages: ["es", "en"],
    difficulty: 2,
    players: [1, 4],
    priceCents: 299,
    day: 4,
  }),
  room({
    id: "mansion",
    title: "La Mansión",
    languages: ["es", "en", "fr"],
    difficulty: 3,
    players: [2, 4],
    priceCents: 1500,
    day: 5,
  }),
  {
    ...room({
      id: "borrador",
      title: "Borrador",
      languages: ["es"],
      difficulty: 2,
      players: [1, 4],
      priceCents: 0,
      day: 6,
    }),
    status: "draft",
  },
];

const REVIEW_ROOMS = ROOMS.map((r) => ({ roomId: r.roomId, authorId: "autor" }));

function setup() {
  const reviews = createInMemoryReviewStore({ rooms: REVIEW_ROOMS });
  const catalog = createCatalogService({
    rooms: createInMemoryRoomPackageRepository(fixture),
    listing: createInMemoryPublishedRoomListing(ROOMS, { ratings: reviews.ratingStats }),
  });
  return { catalog, reviews };
}

async function list(input: CatalogListInput = {}) {
  const { items } = await setup().catalog.listRooms(ANONYMOUS_ACTOR, input);
  return items.map((r) => r.id);
}

describe("catalogService.listRooms — filtros combinables", () => {
  it("sin filtros: todas las publicadas, más recientes primero", async () => {
    expect(await list()).toEqual(["mansion", "nocturno", "lab", "castillo", "cripta"]);
  });

  it("idioma (languages @>) + dificultad", async () => {
    expect(await list({ language: "es", difficulty: "2" })).toEqual(["nocturno", "castillo"]);
    expect(await list({ language: ["en", "fr"], difficulty: 3 })).toEqual(["mansion", "lab"]);
  });

  it("idioma + nº de jugadores (min ≤ n ≤ max)", async () => {
    expect(await list({ language: "en", players: "3" })).toEqual(["mansion", "nocturno", "lab"]);
    expect(await list({ players: 6 })).toEqual(["castillo"]);
    expect(await list({ players: 7 })).toEqual([]);
  });

  it("rango de precio (sin precio cuenta como gratis) + idioma", async () => {
    expect(await list({ language: "es", maxPrice: "500" })).toEqual([
      "nocturno",
      "castillo",
      "cripta",
    ]);
    expect(await list({ minPrice: 300, maxPrice: 1000 })).toEqual(["lab", "castillo"]);
    expect(await list({ maxPrice: 0 })).toEqual(["cripta"]);
  });

  it("varias dificultades + jugadores", async () => {
    expect(await list({ difficulty: "2,3", players: 5 })).toEqual(["lab", "castillo"]);
    expect(await list({ difficulty: ["1", "3"] })).toEqual(["mansion", "lab", "cripta"]);
  });

  it("todos los filtros a la vez", async () => {
    expect(
      await list({
        language: "en,fr",
        difficulty: "3",
        players: "2",
        minPrice: "1000",
        maxPrice: "2000",
      }),
    ).toEqual(["mansion"]);
    expect(
      await list({ language: "es", difficulty: "2", players: "2", maxPrice: "400", q: "castillo" }),
    ).toEqual(["nocturno"]);
  });

  it("búsqueda por título sin distinguir mayúsculas; `%` es literal", async () => {
    expect(await list({ q: "CASTILLO" })).toEqual(["nocturno", "castillo"]);
    expect(await list({ q: "50%" })).toEqual(["lab"]);
    expect(escapeLikePattern("50%_\\")).toBe("50\\%\\_\\\\");
  });

  it("ordena por precio", async () => {
    expect(await list({ sort: "price_asc" })).toEqual([
      "cripta",
      "nocturno",
      "castillo",
      "lab",
      "mansion",
    ]);
    expect(await list({ sort: "price_desc", language: "es" })).toEqual([
      "mansion",
      "castillo",
      "nocturno",
      "cripta",
    ]);
  });

  it("pagina con cursor opaco hasta agotar el listado", async () => {
    const { catalog } = setup();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await catalog.listRooms(ANONYMOUS_ACTOR, { limit: 2, cursor });
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect(seen).toEqual(["mansion", "nocturno", "lab", "castillo", "cripta"]);

    // La paginación respeta los filtros.
    const first = await catalog.listRooms(ANONYMOUS_ACTOR, { language: "es", limit: 3 });
    expect(first.items.map((r) => r.id)).toEqual(["mansion", "nocturno", "castillo"]);
    const second = await catalog.listRooms(ANONYMOUS_ACTOR, {
      language: "es",
      limit: 3,
      cursor: first.nextCursor,
    });
    expect(second).toMatchObject({ nextCursor: null });
    expect(second.items.map((r) => r.id)).toEqual(["cripta"]);
  });

  it("rechaza filtros no válidos con VALIDATION_ERROR", () => {
    const bad: CatalogListInput[] = [
      { difficulty: "4" },
      { difficulty: "facil" },
      { minPrice: "-1" },
      { minPrice: "10", maxPrice: "5" },
      { maxPrice: "1.5" },
      { players: "0" },
      { players: "101" },
      { sort: "popular" },
      { cursor: "no-es-un-cursor" },
      { limit: "51" },
      { q: "x".repeat(101) },
      { language: "english" },
    ];
    for (const input of bad) {
      expect(() => parseCatalogQuery(input), JSON.stringify(input)).toThrow(CatalogError);
    }
    expect(parseCatalogQuery({ q: "  ", sort: "" })).toMatchObject({
      filter: { q: null, sort: "recent", difficulties: [], players: null },
      offset: 0,
      limit: 20,
    });
  });
});

describe("rating agregado en el listado y el detalle", () => {
  it("media (1 decimal) y recuento correctos; orden por rating con desempate", async () => {
    const { catalog, reviews } = setup();
    await reviews.upsert({ userId: "u1", roomId: "castillo", rating: 5, text: null });
    await reviews.upsert({ userId: "u2", roomId: "castillo", rating: 4, text: null });
    await reviews.upsert({ userId: "u3", roomId: "castillo", rating: 4, text: null });
    await reviews.upsert({ userId: "u1", roomId: "nocturno", rating: 5, text: null });

    const { items } = await catalog.listRooms(ANONYMOUS_ACTOR, { sort: "rating" });
    expect(items.map((r) => [r.id, r.ratingAvg, r.ratingCount])).toEqual([
      ["nocturno", 5, 1],
      ["castillo", 4.3, 3],
      ["mansion", null, 0],
      ["lab", null, 0],
      ["cripta", null, 0],
    ]);

    // Editar una reseña (upsert) recalcula sin duplicar.
    await reviews.upsert({ userId: "u1", roomId: "castillo", rating: 1, text: null });
    const detail = await catalog.getRoom(ANONYMOUS_ACTOR, "castillo");
    expect(detail).toMatchObject({ ratingAvg: 3, ratingCount: 3 });
  });

  it("el detalle tiene la forma de specs/13 §3 (sin el package)", async () => {
    const detail = await setup().catalog.getRoom(ANONYMOUS_ACTOR, "castillo");
    expect(detail).toEqual({
      id: "castillo",
      title: "El Castillo",
      authorId: "author",
      authorDisplayName: "Autor de El Castillo",
      coverImageKey: null,
      description: fixture.meta.description,
      theme: "medieval",
      difficulty: 2,
      languages: ["es"],
      defaultLanguage: "es",
      estimatedMinutes: 55,
      players: { min: 2, max: 6 },
      priceCents: 499,
      currency: "EUR",
      saleIndividual: true,
      saleEvents: true,
      licensePriceCents: null,
      ratingAvg: null,
      ratingCount: 0,
      latestVersion: {
        id: "v-castillo",
        semver: "1.0.0",
        publishedAt: "2026-01-02T00:00:00.000Z",
      },
    });
    expect(detail).not.toHaveProperty("package");
  });

  it("una sala que no está en catálogo da ROOM_NOT_FOUND", async () => {
    const { catalog } = setup();
    await expect(catalog.getRoom(ANONYMOUS_ACTOR, "borrador")).rejects.toMatchObject({
      code: "ROOM_NOT_FOUND",
    });
    await expect(catalog.getRoom(ANONYMOUS_ACTOR, "no-existe")).rejects.toBeInstanceOf(
      CatalogError,
    );
  });
});
