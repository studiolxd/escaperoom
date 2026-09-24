"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { LOCALES } from "@escaperoom/config/locales";
import { useRouter } from "@/i18n/navigation";
import { CATALOG_PATH } from "@/lib/catalog-seo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
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

/**
 * Copia local de `CATALOG_SORTS` (en vez de importarla de
 * `@escaperoom/shared/services`): este componente es cliente y ese paquete
 * arrastra Prisma/`node:fs` al bundle del navegador.
 */
const CATALOG_SORTS = ["recent", "rating", "price_asc", "price_desc"] as const;
const SORT_LABEL: Record<(typeof CATALOG_SORTS)[number], string> = {
  recent: "sortRecent",
  rating: "sortRating",
  price_asc: "sortPriceAsc",
  price_desc: "sortPriceDesc",
};

const PLAYER_OPTIONS = [1, 2, 3, 4, 5, 6] as const;

/** Escalones fijos del slider de precio máximo, en euros; el último es "sin límite". */
export const PRICE_STEPS_EUROS = [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;
const UNLIMITED_INDEX = PRICE_STEPS_EUROS.length;

/** Índice del slider ↔ `maxPrice` en céntimos que se manda a la API (`undefined` = sin límite). */
function centsAtIndex(index: number): number | undefined {
  if (index >= UNLIMITED_INDEX) return undefined;
  return PRICE_STEPS_EUROS[index]! * 100;
}

function indexForCents(cents: string | undefined): number {
  if (!cents) return UNLIMITED_INDEX;
  const euros = Number(cents) / 100;
  const found = PRICE_STEPS_EUROS.indexOf(euros as (typeof PRICE_STEPS_EUROS)[number]);
  return found === -1 ? UNLIMITED_INDEX : found;
}

const SEARCH_DEBOUNCE_MS = 400;
const ANY = "__any__";

/**
 * Filtros del catálogo: cada cambio aplica al instante (navega con los nuevos
 * parámetros de la URL, mismos que `GET /api/rooms`), sin botón "Aplicar" ni
 * "Quitar filtros". El campo de texto libre lleva un pequeño debounce para no
 * disparar una navegación en cada tecla.
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
  const router = useRouter();
  const id = useId();
  const euros = (cents: number) =>
    format.number(cents / 100, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  const [q, setQ] = useState(values.q ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigate = useCallback(
    (next: CatalogFilterValues) => {
      const query: Record<string, string> = {};
      for (const [key, value] of Object.entries(next)) {
        if (value) query[key] = value;
      }
      router.push({ pathname: CATALOG_PATH, query });
    },
    [router],
  );

  function onFieldChange(key: keyof CatalogFilterValues, value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    navigate({ ...values, q: q || undefined, [key]: value || undefined });
  }

  // Debounce solo el texto libre; el resto de campos navegan al cambiar. Si
  // `q` ya coincide con la URL actual (al montar, o porque el cambio viene de
  // fuera: navegador/otro filtro), no hay nada que navegar.
  useEffect(() => {
    if (q === (values.q ?? "")) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      navigate({ ...values, q: q || undefined });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, values, navigate]);

  // Si la navegación viene de otro filtro (o del navegador), sincroniza `q`.
  useEffect(() => {
    setQ(values.q ?? "");
  }, [values.q]);

  const priceIndex = indexForCents(values.maxPrice);

  return (
    <div
      role="group"
      aria-label={t("filtersLabel")}
      className="grid gap-3 rounded-xl border border-border bg-muted/40 p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <div className="flex flex-col gap-1 text-sm sm:col-span-2 lg:col-span-4">
        <Label htmlFor={`${id}-q`}>{t("search")}</Label>
        <Input
          id={`${id}-q`}
          type="search"
          value={q}
          maxLength={100}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <Label htmlFor={`${id}-language`}>{t("language")}</Label>
        <Select
          value={values.language || ANY}
          onValueChange={(value) => onFieldChange("language", value === ANY ? "" : value)}
        >
          <SelectTrigger id={`${id}-language`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("anyLanguage")}</SelectItem>
            {LOCALES.map((code) => (
              <SelectItem key={code} value={code}>
                {languageName(code, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <Label htmlFor={`${id}-difficulty`}>{t("difficulty")}</Label>
        <Select
          value={values.difficulty || ANY}
          onValueChange={(value) => onFieldChange("difficulty", value === ANY ? "" : value)}
        >
          <SelectTrigger id={`${id}-difficulty`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("anyDifficulty")}</SelectItem>
            {([1, 2, 3] as const).map((level) => (
              <SelectItem key={level} value={String(level)}>
                {t(`difficulty${level}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <Label htmlFor={`${id}-players`}>{t("players")}</Label>
        <Select
          value={values.players || ANY}
          onValueChange={(value) => onFieldChange("players", value === ANY ? "" : value)}
        >
          <SelectTrigger id={`${id}-players`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("anyPlayers")}</SelectItem>
            {PLAYER_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={`${id}-max-price`}>{t("priceMax")}</Label>
          <span className="text-xs text-muted-foreground">
            {priceIndex >= UNLIMITED_INDEX
              ? t("priceUnlimited")
              : euros(PRICE_STEPS_EUROS[priceIndex]! * 100)}
          </span>
        </div>
        <Slider
          id={`${id}-max-price`}
          min={0}
          max={UNLIMITED_INDEX}
          step={1}
          value={[priceIndex]}
          onValueChange={([index]) => {
            const cents = centsAtIndex(index ?? UNLIMITED_INDEX);
            onFieldChange("maxPrice", cents === undefined ? "" : String(cents));
          }}
          aria-valuetext={
            priceIndex >= UNLIMITED_INDEX
              ? t("priceUnlimited")
              : euros(PRICE_STEPS_EUROS[priceIndex]! * 100)
          }
        />
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <Label htmlFor={`${id}-sort`}>{t("sort")}</Label>
        <Select
          value={values.sort || "recent"}
          onValueChange={(value) => onFieldChange("sort", value)}
        >
          <SelectTrigger id={`${id}-sort`} className="w-full">
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
    </div>
  );
}
