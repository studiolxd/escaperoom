import { CATALOG_SORTS, type CatalogSort } from "@escaperoom/shared/services";
import { LOCALES } from "@escaperoom/config/locales";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { CATALOG_PATH } from "@/lib/catalog-seo";
import { Button } from "@/components/ui/button";
import { languageName } from "./language-name";

/** Valores de los filtros tal y como están en la URL del listado. */
export type CatalogFilterValues = {
  q?: string;
  language?: string;
  difficulty?: string;
  players?: string;
  maxPrice?: string;
  sort?: string;
};

/** Topes de precio del selector, en céntimos (la API admite cualquier rango). */
export const PRICE_CAPS = [0, 500, 1000, 2000] as const;
const PLAYER_OPTIONS = [1, 2, 3, 4, 5, 6] as const;

const SORT_LABEL: Record<CatalogSort, string> = {
  recent: "sortRecent",
  rating: "sortRating",
  price_asc: "sortPriceAsc",
  price_desc: "sortPriceDesc",
};

const fieldClass =
  "h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 outline-none";

/**
 * Filtros del catálogo como formulario GET: funcionan sin JavaScript y cada
 * combinación tiene una URL propia (enlazable e indexable). Los parámetros son
 * los mismos que los de `GET /api/rooms`.
 */
export function CatalogFilters({
  values,
  locale,
}: {
  values: CatalogFilterValues;
  locale: string;
}) {
  const t = useTranslations("Catalog");
  const format = useFormatter();
  const euros = (cents: number) =>
    format.number(cents / 100, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  return (
    <form
      method="get"
      aria-label={t("filtersLabel")}
      className="grid gap-3 rounded-xl border border-border bg-muted/40 p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <label className="flex flex-col gap-1 text-sm sm:col-span-2 lg:col-span-4">
        {t("search")}
        <input
          type="search"
          name="q"
          defaultValue={values.q ?? ""}
          maxLength={100}
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("language")}
        <select name="language" defaultValue={values.language ?? ""} className={fieldClass}>
          <option value="">{t("anyLanguage")}</option>
          {LOCALES.map((code) => (
            <option key={code} value={code}>
              {languageName(code, locale)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("difficulty")}
        <select name="difficulty" defaultValue={values.difficulty ?? ""} className={fieldClass}>
          <option value="">{t("anyDifficulty")}</option>
          {([1, 2, 3] as const).map((level) => (
            <option key={level} value={String(level)}>
              {t(`difficulty${level}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("players")}
        <select name="players" defaultValue={values.players ?? ""} className={fieldClass}>
          <option value="">{t("anyPlayers")}</option>
          {PLAYER_OPTIONS.map((n) => (
            <option key={n} value={String(n)}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("price")}
        <select name="maxPrice" defaultValue={values.maxPrice ?? ""} className={fieldClass}>
          <option value="">{t("anyPrice")}</option>
          {PRICE_CAPS.map((cents) => (
            <option key={cents} value={String(cents)}>
              {cents === 0 ? t("priceFree") : t("priceUpTo", { price: euros(cents) })}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("sort")}
        <select name="sort" defaultValue={values.sort ?? "recent"} className={fieldClass}>
          {CATALOG_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {t(SORT_LABEL[sort])}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-3">
        <Button type="submit" size="lg">
          {t("apply")}
        </Button>
        <Link href={CATALOG_PATH} className="text-sm underline-offset-4 hover:underline">
          {t("reset")}
        </Link>
      </div>
    </form>
  );
}
