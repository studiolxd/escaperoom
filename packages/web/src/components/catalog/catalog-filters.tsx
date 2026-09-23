import { CATALOG_SORTS, type CatalogSort } from "@escaperoom/shared/services";
import { LOCALES } from "@escaperoom/config/locales";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { CATALOG_PATH } from "@/lib/catalog-seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CatalogFilterSelect } from "./catalog-filter-select";
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

/**
 * Filtros del catálogo como formulario GET: funcionan sin JavaScript y cada
 * combinación tiene una URL propia (enlazable e indexable). Los parámetros son
 * los mismos que los de `GET /api/rooms`.
 *
 * Server Component: solo `CatalogFilterSelect` (idioma/dificultad/jugadores/
 * precio) se hidrata en cliente, en su propio archivo — este componente no
 * puede llevar `"use client"` sin arrastrar `@escaperoom/shared/services`
 * (Prisma, `node:fs`, …) al bundle del navegador.
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
      <div className="flex flex-col gap-1 text-sm sm:col-span-2 lg:col-span-4">
        <Label htmlFor="filter-q">{t("search")}</Label>
        <Input
          id="filter-q"
          type="search"
          name="q"
          defaultValue={values.q ?? ""}
          maxLength={100}
        />
      </div>
      <CatalogFilterSelect
        id="filter-language"
        name="language"
        label={t("language")}
        anyLabel={t("anyLanguage")}
        initialValue={values.language ?? ""}
        options={LOCALES.map((code) => ({ value: code, label: languageName(code, locale) }))}
      />
      <CatalogFilterSelect
        id="filter-difficulty"
        name="difficulty"
        label={t("difficulty")}
        anyLabel={t("anyDifficulty")}
        initialValue={values.difficulty ?? ""}
        options={([1, 2, 3] as const).map((level) => ({
          value: String(level),
          label: t(`difficulty${level}`),
        }))}
      />
      <CatalogFilterSelect
        id="filter-players"
        name="players"
        label={t("players")}
        anyLabel={t("anyPlayers")}
        initialValue={values.players ?? ""}
        options={PLAYER_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
      />
      <CatalogFilterSelect
        id="filter-max-price"
        name="maxPrice"
        label={t("price")}
        anyLabel={t("anyPrice")}
        initialValue={values.maxPrice ?? ""}
        options={PRICE_CAPS.map((cents) => ({
          value: String(cents),
          label: cents === 0 ? t("priceFree") : t("priceUpTo", { price: euros(cents) }),
        }))}
      />
      <div className="flex flex-col gap-1 text-sm">
        <Label htmlFor="filter-sort">{t("sort")}</Label>
        <Select name="sort" defaultValue={values.sort ?? "recent"}>
          <SelectTrigger id="filter-sort" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATALOG_SORTS.map((sort) => (
              <SelectItem key={sort} value={sort}>
                {t(SORT_LABEL[sort])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
