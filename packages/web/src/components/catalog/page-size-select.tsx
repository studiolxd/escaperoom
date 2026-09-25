"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { CATALOG_PATH } from "@/lib/catalog-seo";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Múltiplos de 6 (mcm de las 1/2/3 columnas del grid): sin filas a medias. */
const PAGE_SIZE_OPTIONS = [6, 12, 24, 48] as const;

/**
 * Selector de "salas por página"; cambiarlo vuelve siempre a la página 1.
 * Componente cliente: no importa de `@escaperoom/shared/services` (el
 * barrel arrastra dependencias solo-de-servidor como `bullmq`/`child_process`
 * al bundle del navegador), por eso `defaultPageSize` llega por prop desde el
 * componente servidor.
 */
export function PageSizeSelect({
  pageSize,
  defaultPageSize,
  query,
}: {
  pageSize: number;
  defaultPageSize: number;
  query: Record<string, string>;
}) {
  const t = useTranslations("Catalog");
  const router = useRouter();
  const id = useId();

  return (
    <div className="flex shrink-0 items-center gap-2 text-sm">
      <Label htmlFor={`${id}-page-size`} className="whitespace-nowrap">
        {t("pageSize")}
      </Label>
      <Select
        value={String(pageSize)}
        onValueChange={(value) => {
          const next: Record<string, string> = { ...query };
          if (Number(value) === defaultPageSize) delete next.limit;
          else next.limit = value;
          delete next.page;
          router.push({ pathname: CATALOG_PATH, query: next });
        }}
      >
        <SelectTrigger id={`${id}-page-size`} className="w-20 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZE_OPTIONS.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
