import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createCatalogService,
  createInMemoryPublishedRoomListing,
  createInMemoryReviewStore,
  createInMemoryRoomPackageRepository,
  createReviewService,
  type Actor,
} from "@escaperoom/shared/services";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import de from "../messages/de.json";
import en from "../messages/en.json";
import es from "../messages/es.json";
import fr from "../messages/fr.json";
import nl from "../messages/nl.json";
import pt from "../messages/pt.json";
import { deepMergeMessages, type Messages } from "../src/i18n/messages";

// ---------------------------------------------------------------------------
// Páginas SSR del catálogo renderizadas fuera de Next: los servicios son los
// de memoria y se sustituyen las piezas de Next/next-intl que solo existen
// dentro del servidor (request locale, cabeceras, notFound, router).
// ---------------------------------------------------------------------------

const MESSAGES: Record<string, Messages> = Object.fromEntries(
  Object.entries({ es, en, fr, de, nl, pt }).map(([locale, messages]) => [
    locale,
    deepMergeMessages(es, messages),
  ]),
);

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { meta: Record<string, unknown> };

const ROOM_ID = "0b6f4c0e-5d1a-4c55-9d7c-8f1f2a3b4c5d";

const state = vi.hoisted(() => ({
  catalog: null as unknown,
  reviews: null as unknown,
  actor: null as unknown,
}));

vi.mock("@/server/services", () => ({
  getCatalogService: () => state.catalog,
  getReviewService: () => state.reviews,
}));
vi.mock("@/server/context", () => ({
  resolveActorFromHeaders: async () => state.actor,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh() {} }),
}));
// `Link` de next-intl importa `next/navigation`, que solo resuelve dentro de
// Next: aquí basta un `<a>` con el prefijo de locale (`localePrefix: "always"`).
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string | { pathname: string; query?: Record<string, string> };
    children?: unknown;
  }) => {
    const url =
      typeof href === "string"
        ? href
        : `${href.pathname}${href.query ? `?${new URLSearchParams(href.query).toString()}` : ""}`;
    return createElement("a", { ...rest, href: `/es${url}` }, children as never);
  },
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
    createTranslator({ locale, messages: MESSAGES[locale] ?? es, namespace: namespace as never }),
}));

const { default: RoomDetailPage, generateMetadata: roomMetadata } = await import(
  "../src/app/[locale]/(public)/rooms/[roomId]/page"
);
const { default: CatalogPage, generateMetadata: catalogMetadata } = await import(
  "../src/app/[locale]/(public)/rooms/page"
);

const member = (userId: string): Actor => ({ userId, organizationId: null, role: "member" });

beforeEach(async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://escape.example";
  const store = createInMemoryReviewStore({
    rooms: [{ roomId: ROOM_ID, authorId: "autora" }],
    eligible: [`ana:${ROOM_ID}`, `bruno:${ROOM_ID}`],
    users: { ana: "Ana", bruno: "Bruno <b>" },
  });
  state.reviews = createReviewService({ store });
  state.catalog = createCatalogService({
    rooms: createInMemoryRoomPackageRepository(fixture),
    listing: createInMemoryPublishedRoomListing(
      [
        {
          roomId: ROOM_ID,
          status: "published",
          authorDisplayName: "EscapeHub",
          priceCents: 299,
          versions: [
            {
              id: "v1",
              semver: "1.2.0",
              publishedAt: new Date("2026-09-01T10:00:00Z"),
              package: {
                ...fixture,
                meta: { ...fixture.meta, languages: ["es", "en"] },
              },
            },
          ],
        },
      ],
      { ratings: store.ratingStats },
    ),
  });
  state.actor = member("ana");
  await store.upsert({ userId: "ana", roomId: ROOM_ID, rating: 5, text: "Brutal </script>" });
  await store.upsert({ userId: "bruno", roomId: ROOM_ID, rating: 4, text: null });
});

function render(element: ReactElement, locale = "es"): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale,
      messages: MESSAGES[locale],
      timeZone: "UTC",
      children: element,
    }),
  );
}

const roomParams = (locale: string, roomId = ROOM_ID) => ({
  params: Promise.resolve({ locale, roomId }),
  searchParams: Promise.resolve({}),
});

function extractJsonLd(html: string): Record<string, unknown> {
  const match = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html);
  if (!match?.[1]) throw new Error("sin JSON-LD");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("detalle de sala — generateMetadata", () => {
  it("título/descripción por locale, canónica y hreflang a los 6 locales", async () => {
    const metaEs = await roomMetadata(roomParams("es"));
    expect(metaEs.title).toBe("La Maldición del Rey Aldric · Escape room online");
    expect(metaEs.description).toMatch(/^El rey Aldric fue traicionado/);
    expect((metaEs.description as string).length).toBeLessThanOrEqual(160);
    expect(metaEs.alternates?.canonical).toBe(`https://escape.example/es/rooms/${ROOM_ID}`);
    expect(metaEs.alternates?.languages).toEqual({
      en: `https://escape.example/en/rooms/${ROOM_ID}`,
      es: `https://escape.example/es/rooms/${ROOM_ID}`,
      fr: `https://escape.example/fr/rooms/${ROOM_ID}`,
      de: `https://escape.example/de/rooms/${ROOM_ID}`,
      nl: `https://escape.example/nl/rooms/${ROOM_ID}`,
      pt: `https://escape.example/pt/rooms/${ROOM_ID}`,
      "x-default": `https://escape.example/es/rooms/${ROOM_ID}`,
    });
    expect(metaEs.openGraph).toMatchObject({
      locale: "es",
      url: `https://escape.example/es/rooms/${ROOM_ID}`,
    });

    const metaDe = await roomMetadata(roomParams("de"));
    expect(metaDe.title).toBe("La Maldición del Rey Aldric · Online-Escape-Room");
    expect(metaDe.alternates?.canonical).toBe(`https://escape.example/de/rooms/${ROOM_ID}`);
  });

  it("una sala fuera de catálogo no es indexable", async () => {
    expect(await roomMetadata(roomParams("es", "no-existe"))).toEqual({
      robots: { index: false, follow: false },
    });
  });
});

describe("detalle de sala — render SSR", () => {
  it("pinta ficha, rating, reseñas y JSON-LD Product/Game con rating agregado", async () => {
    const html = render(await RoomDetailPage(roomParams("es")));
    expect(html).toContain("<h1");
    expect(html).toContain("La Maldición del Rey Aldric");
    expect(html).toContain("4,5 de 5 (2 reseñas)");
    expect(html).toContain("Media");
    expect(html).toContain("1–4 jugadores");
    expect(html).toContain("Español, Inglés");
    expect(html).toContain("2,99");
    // La reseña del visitante precarga el formulario de edición.
    expect(html).toContain("Edita tu reseña");
    // El texto de la reseña sale escapado en el HTML.
    expect(html).toContain("Brutal &lt;/script&gt;");

    const jsonLd = extractJsonLd(html);
    expect(jsonLd).toMatchObject({
      "@context": "https://schema.org",
      "@type": ["Product", "Game"],
      url: `https://escape.example/es/rooms/${ROOM_ID}`,
      name: "La Maldición del Rey Aldric",
      inLanguage: ["es", "en"],
      numberOfPlayers: { "@type": "QuantitativeValue", minValue: 1, maxValue: 4 },
      timeRequired: "PT55M",
      offers: { "@type": "Offer", price: "2.99", priceCurrency: "EUR" },
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: 4.5,
        reviewCount: 2,
        bestRating: 5,
        worstRating: 1,
      },
    });
    expect((jsonLd.review as unknown[]).length).toBe(2);
    // Un `</script>` en una reseña no puede cerrar la etiqueta del JSON-LD.
    expect(html).not.toMatch(/Brutal <\/script>/);
  });

  it("sin reseñas no emite aggregateRating; anónimo no ve el formulario de reseña", async () => {
    const store = createInMemoryReviewStore({ rooms: [{ roomId: ROOM_ID, authorId: "autora" }] });
    state.reviews = createReviewService({ store });
    state.catalog = createCatalogService({
      rooms: createInMemoryRoomPackageRepository(fixture),
      listing: createInMemoryPublishedRoomListing(
        [
          {
            roomId: ROOM_ID,
            status: "published",
            saleIndividual: false,
            versions: [{ id: "v1", semver: "1.0.0", publishedAt: new Date(), package: fixture }],
          },
        ],
        { ratings: store.ratingStats },
      ),
    });
    state.actor = { userId: "anonymous", organizationId: null, role: "anonymous" };
    const html = render(await RoomDetailPage(roomParams("en")), "en");
    const jsonLd = extractJsonLd(html);
    expect(jsonLd).not.toHaveProperty("aggregateRating");
    expect(jsonLd).not.toHaveProperty("offers");
    expect(html).not.toContain("Your review");
    expect(html).toContain("No reviews yet");
  });

  it("404 para una sala fuera de catálogo", async () => {
    await expect(RoomDetailPage(roomParams("es", "no-existe"))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("listado — SSR", () => {
  it("metadata del listado por locale con hreflang", async () => {
    const meta = await catalogMetadata({ params: Promise.resolve({ locale: "fr" }) });
    expect(meta.title).toBe("Catalogue d'escape games en ligne");
    expect(meta.alternates?.canonical).toBe("https://escape.example/fr/rooms");
    expect(Object.keys(meta.alternates?.languages ?? {}).sort()).toEqual(
      ["de", "en", "es", "fr", "nl", "pt", "x-default"].sort(),
    );
  });

  it("aplica los filtros de la URL y avisa si alguno no es válido", async () => {
    const page = (searchParams: Record<string, string>) =>
      CatalogPage({
        params: Promise.resolve({ locale: "es" }),
        searchParams: Promise.resolve(searchParams),
      });

    const match = render(await page({ language: "en", players: "4", maxPrice: "500" }));
    expect(match).toContain(`data-room-id="${ROOM_ID}"`);
    expect(match).toContain("4,5 de 5 (2 reseñas)");

    const none = render(await page({ language: "fr" }));
    expect(none).toContain("No hay salas que cumplan estos filtros.");

    const invalid = render(await page({ difficulty: "9" }));
    expect(invalid).toContain("Algún filtro no es válido");
    expect(invalid).toContain(`data-room-id="${ROOM_ID}"`);
  });
});
