import { ANONYMOUS_ACTOR, CatalogError, type CatalogListResult } from "@escaperoom/shared/services";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { CatalogFilterValues } from "@/components/catalog/catalog-filters";
import { CatalogView } from "@/components/catalog/catalog-view";
import { buildPageMetadata, CATALOG_PATH } from "@/lib/catalog-seo";
import { catalogInputFromSearchParams } from "@/server/rest/rooms-list";
import { getCatalogService } from "@/server/services";

type SearchParams = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> };

const FILTER_KEYS = ["q", "language", "difficulty", "players", "maxPrice", "sort"] as const;

function toSearchParams(raw: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      if (item !== "") params.append(key, item);
    }
  }
  return params;
}

/**
 * Metadata indexable del listado (título/descripción por locale, canónica sin
 * filtros y `hreflang` a los 6 locales). Las combinaciones de filtros apuntan
 * a la canónica para no competir entre sí en buscadores.
 */
export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Catalog" });
  return buildPageMetadata({
    locale,
    path: CATALOG_PATH,
    title: t("metaTitle"),
    description: t("metaDescription"),
  });
}

/**
 * Catálogo público (SSR, ticket 5.3): filtros combinables en la URL (mismos
 * parámetros que `GET /api/rooms`) y paginación por cursor. Un filtro no
 * válido no rompe la página: se avisa y se lista sin filtros.
 */
export default async function CatalogPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = toSearchParams(await searchParams);
  const catalog = getCatalogService();

  let result: CatalogListResult;
  let invalidFilters = false;
  try {
    result = await catalog.listRooms(ANONYMOUS_ACTOR, catalogInputFromSearchParams(query));
  } catch (error) {
    if (!(error instanceof CatalogError)) throw error;
    invalidFilters = true;
    result = await catalog.listRooms(ANONYMOUS_ACTOR);
  }

  const filters: CatalogFilterValues = {};
  if (!invalidFilters) {
    for (const key of FILTER_KEYS) {
      const value = query.get(key);
      if (value) filters[key] = value;
    }
  }

  return (
    <CatalogView
      locale={locale}
      // Ya resuelto: `filters`/`invalidFilters` (la cabecera, fuera del
      // `Suspense`) dependen del mismo resultado, así que no se gana nada
      // difiriendo la consulta aquí. El `Suspense` de `CatalogView` sigue
      // aislando el renderizado de la parrilla igualmente (F-20).
      resultPromise={Promise.resolve(result)}
      filters={filters}
      invalidFilters={invalidFilters}
    />
  );
}
