import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  hasTranslation,
  includesAllLanguages,
  isLanguageCode,
  missingTranslations,
  pickLanguages,
} from "../src/schemas";
import {
  ANONYMOUS_ACTOR,
  CatalogError,
  createCatalogService,
  createInMemoryPublishedRoomListing,
  createInMemoryRoomPackageRepository,
  parseLanguageFilter,
  type InMemoryCatalogRoom,
} from "../src/services";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { meta: Record<string, unknown> };

/** El fixture del Rey Aldric con otros idiomas/título en la `meta`. */
function pkg(title: string, languages: string[]): unknown {
  return { ...fixture, meta: { ...fixture.meta, title, languages, defaultLanguage: languages[0] } };
}

function version(n: number, title: string, languages: string[]) {
  return {
    id: `v-${title}-${n}`,
    semver: `1.${n}.0`,
    publishedAt: new Date(Date.UTC(2026, 0, n)),
    package: pkg(title, languages),
  };
}

const ROOMS: InMemoryCatalogRoom[] = [
  { roomId: "solo-es", status: "published", versions: [version(1, "Solo es", ["es"])] },
  { roomId: "es-en", status: "published", versions: [version(2, "Es y en", ["es", "en"])] },
  { roomId: "en-fr", status: "published", versions: [version(3, "En y fr", ["en", "fr"])] },
  // La última versión retiró el inglés: ya no sale al filtrar por `en`.
  {
    roomId: "retira-en",
    status: "published",
    versions: [version(4, "Retira en", ["es", "en"]), version(5, "Retira en", ["es"])],
  },
  { roomId: "borrador", status: "draft", versions: [version(6, "Borrador", ["en"])] },
  {
    roomId: "borrada",
    status: "published",
    deleted: true,
    versions: [version(7, "Borrada", ["en"])],
  },
];

function service() {
  return createCatalogService({
    rooms: createInMemoryRoomPackageRepository(fixture),
    listing: createInMemoryPublishedRoomListing(ROOMS),
  });
}

const ids = (rooms: Array<{ id: string }>) => rooms.map((room) => room.id);

describe("catalogService.listRooms — filtro por idioma", () => {
  it("sin filtro lista todas las salas publicadas (más recientes primero)", async () => {
    const { items: rooms } = await service().listRooms(ANONYMOUS_ACTOR);
    expect(ids(rooms)).toEqual(["retira-en", "en-fr", "es-en", "solo-es"]);
    expect(rooms[0]).toMatchObject({
      title: "Retira en",
      languages: ["es"],
      defaultLanguage: "es",
      latestVersion: { id: "v-Retira en-5", semver: "1.5.0" },
    });
  });

  it("devuelve solo las salas que incluyen el idioma pedido", async () => {
    const { items: rooms } = await service().listRooms(ANONYMOUS_ACTOR, { language: "en" });
    expect(ids(rooms)).toEqual(["en-fr", "es-en"]);
    expect(rooms.every((room) => room.languages.includes("en"))).toBe(true);
  });

  it("con varios idiomas exige todos (languages @> ARRAY[...])", async () => {
    expect(
      ids((await service().listRooms(ANONYMOUS_ACTOR, { language: ["es", "en"] })).items),
    ).toEqual(["es-en"]);
    expect(ids((await service().listRooms(ANONYMOUS_ACTOR, { language: "en,fr" })).items)).toEqual([
      "en-fr",
    ]);
    expect((await service().listRooms(ANONYMOUS_ACTOR, { language: "de" })).items).toEqual([]);
  });

  it("rechaza códigos de idioma no válidos", async () => {
    await expect(service().listRooms(ANONYMOUS_ACTOR, { language: "english" })).rejects.toThrow(
      CatalogError,
    );
    expect(() => parseLanguageFilter(Array.from({ length: 11 }, (_, i) => `l${i}x`))).toThrow(
      CatalogError,
    );
    expect(parseLanguageFilter([" en ", "en", ""])).toEqual(["en"]);
  });

  it("sin listado inyectado el catálogo publicado está vacío", async () => {
    const onlyFeatured = createCatalogService({
      rooms: createInMemoryRoomPackageRepository(fixture),
    });
    expect(await onlyFeatured.listRooms(ANONYMOUS_ACTOR, { language: "es" })).toEqual({
      items: [],
      nextCursor: null,
      page: 1,
      pageSize: 12,
      totalCount: 0,
      totalPages: 1,
    });
  });
});

describe("helpers de LocalizedText", () => {
  const text = { es: { text: "Hola" }, en: { text: "  " }, fr: { text: "Salut" } };

  it("detecta traducciones faltantes en los idiomas declarados", () => {
    expect(hasTranslation(text, "es")).toBe(true);
    expect(hasTranslation(text, "en")).toBe(false);
    expect(missingTranslations(text, ["es", "en", "de"])).toEqual(["en", "de"]);
    expect(missingTranslations(undefined, ["es"])).toEqual(["es"]);
  });

  it("recorta a los idiomas declarados y compara conjuntos de idiomas", () => {
    expect(pickLanguages(text, ["fr", "es"])).toEqual({
      fr: { text: "Salut" },
      es: { text: "Hola" },
    });
    expect(includesAllLanguages(["es", "en"], ["en"])).toBe(true);
    expect(includesAllLanguages(["es"], ["es", "en"])).toBe(false);
    expect(includesAllLanguages(["es"], [])).toBe(true);
    expect(["es", "pt-BR", "ast"].every(isLanguageCode)).toBe(true);
    expect(["ES", "español", "", "e"].some(isLanguageCode)).toBe(false);
  });
});
