import { LOCALES } from "@escaperoom/config/locales";
import { ANONYMOUS_ACTOR, CATALOG_MAX_LIMIT } from "@escaperoom/shared/services";
import type { MetadataRoute } from "next";
import { CATALOG_PATH, languageAlternates, localizedUrl, roomPath } from "@/lib/catalog-seo";
import { getCatalogService } from "@/server/services";

// Se genera por petición: el catálogo vive en Postgres y no existe en el build.
export const dynamic = "force-dynamic";

/** Tope de salas en el sitemap (el protocolo admite 50 000 URLs por fichero). */
const MAX_ROOMS = 5000;

/**
 * Sitemap del catálogo: el listado y cada sala publicada en los 6 locales,
 * con sus alternativas `hreflang`. Si la base de datos no responde se sirve al
 * menos el listado, antes que un 500 que el buscador cachearía.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = LOCALES.map((locale) => ({
    url: localizedUrl(locale, CATALOG_PATH),
    changeFrequency: "daily",
    priority: 0.8,
    alternates: { languages: languageAlternates(CATALOG_PATH) },
  }));

  try {
    const catalog = getCatalogService();
    let cursor: string | null = null;
    let count = 0;
    do {
      const page = await catalog.listRooms(ANONYMOUS_ACTOR, { cursor, limit: CATALOG_MAX_LIMIT });
      for (const room of page.items) {
        const path = roomPath(room.id);
        for (const locale of LOCALES) {
          entries.push({
            url: localizedUrl(locale, path),
            lastModified: room.latestVersion.publishedAt,
            changeFrequency: "weekly",
            priority: 0.6,
            alternates: { languages: languageAlternates(path) },
          });
        }
      }
      count += page.items.length;
      cursor = page.nextCursor;
    } while (cursor !== null && count < MAX_ROOMS);
  } catch (error) {
    console.error("[sitemap] no se pudo leer el catálogo", error);
  }
  return entries;
}
