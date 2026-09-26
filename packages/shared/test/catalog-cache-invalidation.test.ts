import { describe, expect, it } from "vitest";
import {
  createCachedPublishedRoomListing,
  withCatalogCacheInvalidation,
  type CatalogCacheStore,
} from "../src/services/catalog-listing";
import {
  createInMemoryModerationStore,
  createModerationService,
  type Actor,
} from "../src/services";
import type { CatalogListFilter, CatalogRoom, PublishedRoomListing } from "../src/services/catalog";

/**
 * `getModerationService()`/`getRoomPublishService()`/`getRoomCoverService()`
 * (composition root, `packages/web/src/server/services.ts`) envuelven sus
 * métodos que cambian lo que ve el catálogo con `withCatalogCacheInvalidation`
 * (ver ese archivo). Este test prueba el mismo mecanismo montado con las
 * piezas reales de `shared` (moderación + cache), sin Prisma ni Redis reales,
 * para la retirada por moderación que pidió la coordinadora en la revisión
 * de la PR: un reporte crítico confirmado retira la sala en el acto, y el
 * catálogo no debe seguir sirviéndola desde una foto vieja de la cache.
 */

/** Store en memoria que implementa el subconjunto de `ioredis` que necesita el cache. */
function memoryStore(): CatalogCacheStore {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
  };
}

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

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const AUTHOR_ID = "autora";
const MODERATOR: Actor = { userId: "mod", organizationId: null, role: "member" };
const REPORTER: Actor = { userId: "jugadora", organizationId: null, role: "member" };

function catalogRoom(overrides: Partial<CatalogRoom> = {}): CatalogRoom {
  return {
    id: ROOM_ID,
    title: "Sala",
    authorId: AUTHOR_ID,
    authorDisplayName: "Autora",
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
    ...overrides,
  };
}

/** Refleja `moderationStore.rooms` como lo haría la consulta real de Postgres: solo `published`. */
function listingOverModerationStore(
  moderationStore: ReturnType<typeof createInMemoryModerationStore>,
): PublishedRoomListing {
  const listPublished = async () => {
    const room = moderationStore.rooms.get(ROOM_ID);
    return room?.status === "published" ? [catalogRoom()] : [];
  };
  return {
    listPublished,
    getPublished: async (roomId) => (await listPublished()).find((r) => r.id === roomId) ?? null,
    countPublished: async () => (await listPublished()).length,
  };
}

describe("retirada por moderación invalida el cache del catálogo", () => {
  it("resolveReport (unpublish) hace que el catálogo deje de servir la sala desde una foto en cache", async () => {
    const moderationStore = createInMemoryModerationStore({
      moderatorIds: [MODERATOR.userId],
      rooms: [{ id: ROOM_ID, authorId: AUTHOR_ID, status: "published", title: "Sala" }],
    });
    const moderation = createModerationService({ store: moderationStore });

    const cacheStore = memoryStore();
    const cachedCatalog = createCachedPublishedRoomListing(listingOverModerationStore(moderationStore), {
      store: cacheStore,
      prefix: "er",
    });

    // Punto único de invalidación, igual que en el composition root de web.
    const resolveReport = withCatalogCacheInvalidation(cacheStore, "er", moderation.resolveReport);

    // 1) El catálogo ve la sala publicada y lo cachea.
    expect(await cachedCatalog.listPublished(FILTER, { offset: 0, limit: 20 })).toEqual([
      catalogRoom(),
    ]);

    // 2) Un reporte crítico entra en cola; un moderador lo confirma, lo que
    // retira la sala en el acto (`unpublishRoom` → `status: "removed"`).
    const { report } = await moderation.report(REPORTER, {
      targetType: "room",
      targetId: ROOM_ID,
      category: "minor_safety",
      reason: "Motivo",
    });
    const resolved = await resolveReport(MODERATOR, report.id, { status: "actioned" });
    expect(resolved.report.actionTaken).toBe("unpublish");
    expect(moderationStore.rooms.get(ROOM_ID)?.status).toBe("removed");

    // 3) Sin la invalidación, esta consulta seguiría sirviendo la sala desde
    // el cache (mismo filtro/página, TTL sin expirar): con ella, es un miss
    // que relee el estado real (la sala ya no aparece).
    expect(await cachedCatalog.listPublished(FILTER, { offset: 0, limit: 20 })).toEqual([]);
  });

  it("resolveAppeal (overturned) hace que el catálogo vuelva a servir la sala restaurada", async () => {
    const moderationStore = createInMemoryModerationStore({
      moderatorIds: [MODERATOR.userId],
      rooms: [{ id: ROOM_ID, authorId: AUTHOR_ID, status: "published", title: "Sala" }],
    });
    const moderation = createModerationService({ store: moderationStore });

    const cacheStore = memoryStore();
    const cachedCatalog = createCachedPublishedRoomListing(listingOverModerationStore(moderationStore), {
      store: cacheStore,
      prefix: "er",
    });
    const resolveReport = withCatalogCacheInvalidation(cacheStore, "er", moderation.resolveReport);
    const resolveAppeal = withCatalogCacheInvalidation(cacheStore, "er", moderation.resolveAppeal);

    // "harassment" (severidad "high", no crítica): la sala igual se retira
    // por defecto al confirmar, pero SÍ admite apelación (§7 excluye lo crítico).
    const { report } = await moderation.report(REPORTER, {
      targetType: "room",
      targetId: ROOM_ID,
      category: "harassment",
      reason: "Motivo",
    });
    await resolveReport(MODERATOR, report.id, { status: "actioned" });
    // El cache queda frío (ausente) tras la retirada.
    expect(await cachedCatalog.listPublished(FILTER, { offset: 0, limit: 20 })).toEqual([]);

    const appeal = await moderation.appealRoom(
      { userId: AUTHOR_ID, organizationId: null, role: "member" },
      ROOM_ID,
      { reason: "No fue para tanto, esto es un error" },
    );
    await resolveAppeal(MODERATOR, appeal.id, { decision: "overturned" });
    expect(moderationStore.rooms.get(ROOM_ID)?.status).toBe("published");

    // Sin invalidar, seguiría "ausente" (foto en cache de justo tras retirarla).
    expect(await cachedCatalog.listPublished(FILTER, { offset: 0, limit: 20 })).toEqual([
      catalogRoom(),
    ]);
  });
});
