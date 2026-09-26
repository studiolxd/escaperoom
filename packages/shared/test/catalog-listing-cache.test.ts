import { describe, expect, it, vi } from "vitest";
import {
  createCachedPublishedRoomListing,
  invalidatePublishedRoomListingCache,
  type CatalogCacheStore,
  type CatalogCacheTiming,
} from "../src/services/catalog-listing";
import type { CatalogListFilter, CatalogRoom, PublishedRoomListing } from "../src/services/catalog";

const FILTER: CatalogListFilter = {
  languages: [],
  difficulties: [],
  minPrice: null,
  maxPrice: null,
  playersMin: null,
  playersMax: null,
  q: null,
  sort: "recent",
};

const ROOM: CatalogRoom = {
  id: "room-1",
  title: "Sala",
  authorId: "author-1",
  authorDisplayName: "Autor",
  description: "desc",
  theme: "medieval",
  difficulty: 1,
  languages: ["es"],
  defaultLanguage: "es",
  estimatedMinutes: 30,
  players: { min: 1, max: 4 },
  priceCents: null,
  currency: "EUR",
  saleIndividual: true,
  saleEvents: true,
  licensePriceCents: null,
  coverImageKey: null,
  ratingAvg: null,
  ratingCount: 0,
  latestVersion: { id: "v1", semver: "1.0.0", publishedAt: "2026-01-01T00:00:00.000Z" },
};

/** Store en memoria que implementa el subconjunto de `ioredis` que necesita el cache. */
function memoryStore(): CatalogCacheStore & { size: () => number } {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    size: () => map.size,
  };
}

function countingInner(rooms: CatalogRoom[]): PublishedRoomListing & { calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    async listPublished() {
      calls += 1;
      return rooms;
    },
    async getPublished(roomId) {
      calls += 1;
      return rooms.find((room) => room.id === roomId) ?? null;
    },
    async countPublished() {
      calls += 1;
      return rooms.length;
    },
  };
}

describe("createCachedPublishedRoomListing", () => {
  it("sin store (sin REDIS_URL) pasa directo al listing interno", async () => {
    const inner = countingInner([ROOM]);
    const cached = createCachedPublishedRoomListing(inner, { store: null, prefix: "er" });
    await cached.listPublished(FILTER, { offset: 0, limit: 20 });
    await cached.listPublished(FILTER, { offset: 0, limit: 20 });
    expect(inner.calls()).toBe(2);
  });

  it("la segunda consulta con el mismo filtro no toca el listing interno (cache hit)", async () => {
    const inner = countingInner([ROOM]);
    const store = memoryStore();
    const cached = createCachedPublishedRoomListing(inner, { store, prefix: "er" });

    const first = await cached.listPublished(FILTER, { offset: 0, limit: 20 });
    const second = await cached.listPublished(FILTER, { offset: 0, limit: 20 });

    expect(inner.calls()).toBe(1);
    expect(second).toEqual(first);
    expect(store.size()).toBe(1);
  });

  it("un filtro distinto es una clave de cache distinta", async () => {
    const inner = countingInner([ROOM]);
    const store = memoryStore();
    const cached = createCachedPublishedRoomListing(inner, { store, prefix: "er" });

    await cached.listPublished(FILTER, { offset: 0, limit: 20 });
    await cached.listPublished({ ...FILTER, q: "aldric" }, { offset: 0, limit: 20 });

    expect(inner.calls()).toBe(2);
  });

  it("el orden de construcción del objeto filtro no cambia la clave (stable stringify)", async () => {
    const inner = countingInner([ROOM]);
    const store = memoryStore();
    const cached = createCachedPublishedRoomListing(inner, { store, prefix: "er" });

    const filterA: CatalogListFilter = { ...FILTER, languages: ["es"], q: "aldric" };
    const filterB: CatalogListFilter = {
      q: "aldric",
      languages: ["es"],
      difficulties: FILTER.difficulties,
      minPrice: FILTER.minPrice,
      maxPrice: FILTER.maxPrice,
      playersMin: FILTER.playersMin,
      playersMax: FILTER.playersMax,
      sort: FILTER.sort,
    };

    await cached.listPublished(filterA, { offset: 0, limit: 20 });
    await cached.listPublished(filterB, { offset: 0, limit: 20 });

    expect(inner.calls()).toBe(1);
  });

  it("cachea getPublished por roomId", async () => {
    const inner = countingInner([ROOM]);
    const store = memoryStore();
    const cached = createCachedPublishedRoomListing(inner, { store, prefix: "er" });

    await cached.getPublished("room-1");
    await cached.getPublished("room-1");
    await cached.getPublished("room-2");

    expect(inner.calls()).toBe(2);
  });

  it("un fallo de lectura de Redis cae abierto a Postgres, sin romper la petición", async () => {
    const inner = countingInner([ROOM]);
    const store: CatalogCacheStore = {
      get: vi.fn().mockRejectedValue(new Error("redis caído")),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const cached = createCachedPublishedRoomListing(inner, { store, prefix: "er" });

    const result = await cached.listPublished(FILTER, { offset: 0, limit: 20 });
    expect(result).toEqual([ROOM]);
    expect(inner.calls()).toBe(1);
  });

  it("un fallo de escritura de Redis no rompe la respuesta", async () => {
    const inner = countingInner([ROOM]);
    const store: CatalogCacheStore = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockRejectedValue(new Error("redis caído")),
    };
    const cached = createCachedPublishedRoomListing(inner, { store, prefix: "er" });

    const result = await cached.listPublished(FILTER, { offset: 0, limit: 20 });
    expect(result).toEqual([ROOM]);
  });

  it("reporta timing con hit/miss para medir el efecto del cache", async () => {
    const inner = countingInner([ROOM]);
    const store = memoryStore();
    const timings: CatalogCacheTiming[] = [];
    const cached = createCachedPublishedRoomListing(inner, {
      store,
      prefix: "er",
      onTiming: (t) => timings.push(t),
    });

    await cached.listPublished(FILTER, { offset: 0, limit: 20 });
    await cached.listPublished(FILTER, { offset: 0, limit: 20 });

    expect(timings.map((t) => t.hit)).toEqual([false, true]);
  });

  it(
    "publicar mientras una consulta lenta está en vuelo no deja escrita en cache " +
      "la foto de antes de publicar (deuda 'sala duplicada en el catálogo justo tras publicar')",
    async () => {
      const store = memoryStore();
      // La consulta lenta (empezó ANTES de publicar) ve el catálogo SIN la sala
      // nueva: solo se resuelve cuando el test lo decide, después de publicar.
      let resolveSlowLoad!: (rooms: CatalogRoom[]) => void;
      const slowLoad = new Promise<CatalogRoom[]>((resolve) => {
        resolveSlowLoad = resolve;
      });
      const inner: PublishedRoomListing = {
        listPublished: () => slowLoad,
        getPublished: async () => null,
        countPublished: async () => 0,
      };
      const cached = createCachedPublishedRoomListing(inner, { store, prefix: "er" });

      // 1) Empieza la petición lenta (cache fría): su `load()` queda pendiente.
      const slowRequest = cached.listPublished(FILTER, { offset: 0, limit: 20 });

      // 2) Se publica una sala nueva mientras la lenta sigue en vuelo.
      await invalidatePublishedRoomListingCache(store, "er");

      // 3) Una petición posterior a la publicación es un miss (nueva
      // generación) y ve el catálogo YA con la sala nueva.
      const freshInner = countingInner([ROOM]);
      const freshCached = createCachedPublishedRoomListing(freshInner, { store, prefix: "er" });
      const freshResult = await freshCached.listPublished(FILTER, { offset: 0, limit: 20 });
      expect(freshResult).toEqual([ROOM]);

      // 4) SOLO AHORA se resuelve la lenta: su escritura en cache (fire-and-forget)
      // llega tarde, después de la publicación.
      resolveSlowLoad([]);
      await slowRequest;
      // Deja que el `.catch`/`set` fire-and-forget de la petición lenta corra.
      await new Promise((resolve) => setTimeout(resolve, 0));

      // 5) Una petición posterior sigue viendo el catálogo correcto: la
      // escritura tardía de la lenta cayó en una clave de otra generación,
      // no en la que se está leyendo ahora.
      const afterResult = await freshCached.listPublished(FILTER, { offset: 0, limit: 20 });
      expect(afterResult).toEqual([ROOM]);
    },
  );

  it("invalidatePublishedRoomListingCache sin store no falla (cache desactivado)", async () => {
    await expect(invalidatePublishedRoomListingCache(null, "er")).resolves.toBeUndefined();
  });

  it("invalidatePublishedRoomListingCache cae abierto si Redis no responde", async () => {
    const store: CatalogCacheStore = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockRejectedValue(new Error("redis caído")),
    };
    await expect(invalidatePublishedRoomListingCache(store, "er")).resolves.toBeUndefined();
  });
});
