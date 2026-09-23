import { DEFAULT_LOCALE, LOCALES } from "@escaperoom/config/locales";
import type { CatalogRoom, Review } from "@escaperoom/shared/services";
import type { Metadata } from "next";

/**
 * SEO del catálogo (canal de adquisición, specs/03): URLs absolutas, alternates
 * `hreflang` por locale de la UI, metadata y datos estructurados JSON-LD. Todo
 * puro para poder testearlo sin Next ni base de datos.
 */

/** Origen público de la app, sin barra final (`NEXT_PUBLIC_APP_URL` > `APP_URL`). */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.NEXT_PUBLIC_APP_URL ?? env.APP_URL ?? "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/** Ruta pública del listado y del detalle (sin locale). */
export const CATALOG_PATH = "/rooms";
export const roomPath = (roomId: string) => `${CATALOG_PATH}/${encodeURIComponent(roomId)}`;

/** URL absoluta de una ruta en un locale (`localePrefix: "always"`). */
export function localizedUrl(locale: string, path: string, base = siteUrl()): string {
  return `${base}/${locale}${path}`;
}

/**
 * `hreflang` de una ruta: una alternativa por locale de la UI y `x-default`
 * al idioma por defecto (el que sirve "/").
 */
export function languageAlternates(path: string, base = siteUrl()): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of LOCALES) languages[locale] = localizedUrl(locale, path, base);
  languages["x-default"] = localizedUrl(DEFAULT_LOCALE, path, base);
  return languages;
}

/** Recorta a `max` caracteres por palabra completa (descripciones de meta). */
export function truncateText(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Metadata indexable de una página del catálogo (título/descripción ya traducidos). */
export function buildPageMetadata(input: {
  locale: string;
  path: string;
  title: string;
  description: string;
  base?: string;
}): Metadata {
  const base = input.base ?? siteUrl();
  const url = localizedUrl(input.locale, input.path, base);
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: url, languages: languageAlternates(input.path, base) },
    openGraph: {
      title: input.title,
      description: input.description,
      url,
      type: "website",
      locale: input.locale,
    },
    robots: { index: true, follow: true },
  };
}

/**
 * Metadata del detalle de sala. El título y la descripción de la sala son los
 * de su `RoomPackage` (en el idioma por defecto de la sala); el sufijo del
 * título sale de los mensajes del locale de la UI.
 */
export function buildRoomMetadata(
  room: CatalogRoom,
  locale: string,
  titleTemplate: (roomTitle: string) => string,
  base = siteUrl(),
): Metadata {
  const metadata = buildPageMetadata({
    locale,
    path: roomPath(room.id),
    title: titleTemplate(room.title),
    description: truncateText(room.description),
    base,
  });
  return { ...metadata, openGraph: { ...metadata.openGraph, type: "website" } };
}

/** Precio en unidades decimales como string (schema.org `Offer.price`). */
function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Datos estructurados de la sala: `Product` (para el rating/oferta en
 * buscadores) + `Game` (semántica de juego: jugadores, duración, idiomas).
 * `aggregateRating` solo si hay reseñas (Google lo exige con `reviewCount > 0`)
 * y `offers` solo si se vende individualmente.
 */
export function buildRoomJsonLd(
  room: CatalogRoom,
  url: string,
  reviews: readonly Review[] = [],
): Record<string, unknown> {
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": ["Product", "Game"],
    "@id": url,
    url,
    name: room.title,
    description: room.description,
    category: "Escape room",
    genre: room.theme,
    inLanguage: room.languages,
    numberOfPlayers: {
      "@type": "QuantitativeValue",
      minValue: room.players.min,
      maxValue: room.players.max,
    },
    timeRequired: `PT${Math.round(room.estimatedMinutes)}M`,
    author: { "@type": "Person", name: room.authorDisplayName },
    brand: { "@type": "Brand", name: room.authorDisplayName },
    sku: room.id,
    version: room.latestVersion.semver,
    datePublished: room.latestVersion.publishedAt,
  };
  if (room.saleIndividual) {
    jsonLd.offers = {
      "@type": "Offer",
      url,
      price: formatPrice(room.priceCents ?? 0),
      priceCurrency: room.currency,
      availability: "https://schema.org/InStock",
    };
  }
  if (room.ratingCount > 0 && room.ratingAvg !== null) {
    jsonLd.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: room.ratingAvg,
      reviewCount: room.ratingCount,
      bestRating: 5,
      worstRating: 1,
    };
  }
  if (reviews.length > 0) {
    jsonLd.review = reviews.slice(0, 5).map((review) => ({
      "@type": "Review",
      author: { "@type": "Person", name: review.authorDisplayName },
      datePublished: review.createdAt,
      reviewRating: {
        "@type": "Rating",
        ratingValue: review.rating,
        bestRating: 5,
        worstRating: 1,
      },
      ...(review.text ? { reviewBody: review.text } : {}),
    }));
  }
  return jsonLd;
}

/** JSON-LD para `<script>`: escapa `<` para que un texto no pueda cerrar la etiqueta. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
