import { CATALOG_DEFAULT_LIMIT, type CatalogListResult } from "@escaperoom/shared/services";
import { Suspense } from "react";
import { SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CATALOG_PATH } from "@/lib/catalog-seo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from "@/components/ui/pagination";
import { CatalogFilters, type CatalogFilterValues } from "./catalog-filters";
import { PageSizeSelect } from "./page-size-select";
import { RoomCard } from "./room-card";

function CatalogResultsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-64 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** URL de una página concreta, conservando filtros y `limit` (omitidos si son el valor por defecto). */
function pageHref(query: Record<string, string>, pageSize: number, page: number) {
  const nextQuery: Record<string, string> = { ...query };
  if (pageSize !== CATALOG_DEFAULT_LIMIT) nextQuery.limit = String(pageSize);
  else delete nextQuery.limit;
  if (page > 1) nextQuery.page = String(page);
  else delete nextQuery.page;
  return { pathname: CATALOG_PATH, query: nextQuery };
}

/** Números de página a mostrar: 1, el entorno de la actual, y la última; el resto se colapsa. */
function buildPageItems(current: number, total: number): Array<number | "ellipsis"> {
  const items: Array<number | "ellipsis"> = [1];
  if (current > 3) items.push("ellipsis");
  for (let n = Math.max(2, current - 1); n <= Math.min(total - 1, current + 1); n++) {
    items.push(n);
  }
  if (current < total - 2) items.push("ellipsis");
  if (total > 1) items.push(total);
  return items;
}

function CatalogPagination({
  query,
  page,
  pageSize,
  totalPages,
}: {
  query: Record<string, string>;
  page: number;
  pageSize: number;
  totalPages: number;
}) {
  const t = useTranslations("Catalog");
  return (
    <Pagination className="mx-0 w-auto shrink-0 justify-end">
      <PaginationContent>
        <PaginationItem>
          {page > 1 ? (
            <Button asChild variant="ghost" size="default">
              <Link href={pageHref(query, pageSize, page - 1)} rel="prev">
                {t("previousPage")}
              </Link>
            </Button>
          ) : (
            <Button variant="ghost" size="default" disabled aria-hidden="true">
              {t("previousPage")}
            </Button>
          )}
        </PaginationItem>

        {buildPageItems(page, totalPages).map((item, index) =>
          item === "ellipsis" ? (
            <PaginationItem key={`ellipsis-${index}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={item}>
              <Button asChild variant={item === page ? "outline" : "ghost"} size="icon">
                <Link
                  href={pageHref(query, pageSize, item)}
                  aria-current={item === page ? "page" : undefined}
                >
                  {item}
                </Link>
              </Button>
            </PaginationItem>
          ),
        )}

        <PaginationItem>
          {page < totalPages ? (
            <Button asChild variant="ghost" size="default">
              <Link href={pageHref(query, pageSize, page + 1)} rel="next">
                {t("nextPage")}
              </Link>
            </Button>
          ) : (
            <Button variant="ghost" size="default" disabled aria-hidden="true">
              {t("nextPage")}
            </Button>
          )}
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

/**
 * Solo la parrilla de salas y la paginación esperan a `resultPromise`
 * (F-20): la cabecera y los filtros no dependen de la consulta al catálogo,
 * así que no hace falta bloquearlos detrás del mismo `Suspense`.
 */
async function CatalogResults({
  resultPromise,
  locale,
  query,
}: {
  resultPromise: Promise<CatalogListResult>;
  locale: string;
  query: Record<string, string>;
}) {
  const [t, { items: rooms, page, pageSize, totalPages }] = await Promise.all([
    getTranslations({ locale, namespace: "Catalog" }),
    resultPromise,
  ]);

  return (
    <>
      {rooms.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("emptyDescription")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="link" asChild>
              <Link href={CATALOG_PATH}>{t("emptyClearFilters")}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((room) => (
            <RoomCard key={room.id} room={room} locale={locale} />
          ))}
        </div>
      )}

      {rooms.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageSizeSelect pageSize={pageSize} defaultPageSize={CATALOG_DEFAULT_LIMIT} query={query} />
          {totalPages > 1 ? (
            <CatalogPagination query={query} page={page} pageSize={pageSize} totalPages={totalPages} />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** Listado SSR del catálogo: filtros, tarjetas y paginador real (números de página). */
export function CatalogView({
  locale,
  resultPromise,
  filters,
  invalidFilters,
}: {
  locale: string;
  resultPromise: Promise<CatalogListResult>;
  filters: CatalogFilterValues;
  invalidFilters: boolean;
}) {
  const t = useTranslations("Catalog");
  const query = Object.fromEntries(
    Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 bg-background px-4 py-8 text-foreground">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("heading")}</h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </header>

      <CatalogFilters values={filters} locale={locale} />

      {invalidFilters ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {t("invalidFilters")}
        </p>
      ) : null}

      <Suspense fallback={<CatalogResultsSkeleton />}>
        <CatalogResults resultPromise={resultPromise} locale={locale} query={query} />
      </Suspense>
    </main>
  );
}
