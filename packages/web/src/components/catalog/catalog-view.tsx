import type { CatalogListResult } from "@escaperoom/shared/services";
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
import { CatalogFilters, type CatalogFilterValues } from "./catalog-filters";
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

/**
 * Solo la parrilla de salas y la paginación esperan a `resultPromise`
 * (F-20): la cabecera y los filtros no dependen de la consulta al catálogo,
 * así que no hace falta bloquearlos detrás del mismo `Suspense`.
 */
async function CatalogResults({
  resultPromise,
  locale,
  query,
  isFirstPage,
}: {
  resultPromise: Promise<CatalogListResult>;
  locale: string;
  query: Record<string, string>;
  isFirstPage: boolean;
}) {
  const [t, { items: rooms, nextCursor }] = await Promise.all([
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

      <nav className="flex gap-4 text-sm">
        {!isFirstPage ? (
          <Link
            href={{ pathname: CATALOG_PATH, query }}
            className="underline-offset-4 hover:underline"
          >
            {t("firstPage")}
          </Link>
        ) : null}
        {nextCursor ? (
          <Link
            href={{ pathname: CATALOG_PATH, query: { ...query, cursor: nextCursor } }}
            rel="next"
            className="underline-offset-4 hover:underline"
          >
            {t("nextPage")} →
          </Link>
        ) : null}
      </nav>
    </>
  );
}

/** Listado SSR del catálogo: filtros, tarjetas y paginación por cursor. */
export function CatalogView({
  locale,
  resultPromise,
  filters,
  isFirstPage,
  invalidFilters,
}: {
  locale: string;
  resultPromise: Promise<CatalogListResult>;
  filters: CatalogFilterValues;
  isFirstPage: boolean;
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
        <CatalogResults
          resultPromise={resultPromise}
          locale={locale}
          query={query}
          isFirstPage={isFirstPage}
        />
      </Suspense>
    </main>
  );
}
