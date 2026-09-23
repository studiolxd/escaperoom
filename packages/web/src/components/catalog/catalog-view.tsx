import type { CatalogRoom } from "@escaperoom/shared/services";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { CATALOG_PATH } from "@/lib/catalog-seo";
import { CatalogFilters, type CatalogFilterValues } from "./catalog-filters";
import { RoomCard } from "./room-card";

/** Listado SSR del catálogo: filtros, tarjetas y paginación por cursor. */
export function CatalogView({
  locale,
  rooms,
  nextCursor,
  filters,
  isFirstPage,
  invalidFilters,
}: {
  locale: string;
  rooms: CatalogRoom[];
  nextCursor: string | null;
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

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t("results", { count: rooms.length })}
      </p>

      {rooms.length === 0 ? (
        <p>{t("empty")}</p>
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
    </main>
  );
}
