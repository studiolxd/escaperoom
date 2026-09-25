"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { LOCALES, type Locale } from "@escaperoom/config/locales";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * Selector de idioma (patrón de next-intl): conserva la ruta actual y cambia
 * solo el segmento de locale.
 *
 * `variant="overlay"` (por defecto): fila de `Button` con contraste
 * garantizado sobre el overlay oscuro del HUD/editor/lobby (ADR-019) — es el
 * usado en casi todas las páginas, que pintan sobre un fondo de juego oscuro.
 * `variant="select"`: `Select` de shadcn con el estilo por defecto (fondo
 * claro), para el header público (`PublicHeader`), que ya no va sobre overlay.
 */
export function LocaleSwitcher({
  variant = "overlay",
  id,
}: {
  variant?: "overlay" | "select";
  id?: string;
}) {
  const t = useTranslations("LocaleSwitcher");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function onSelect(nextLocale: Locale) {
    if (nextLocale === locale) {
      return;
    }
    startTransition(() => {
      router.replace(pathname, { locale: nextLocale });
    });
  }

  if (variant === "select") {
    return (
      <Select value={locale} onValueChange={(value) => onSelect(value as Locale)}>
        <SelectTrigger id={id} aria-label={t("label")} disabled={isPending}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LOCALES.map((option) => (
            <SelectItem key={option} value={option}>
              {option.toUpperCase()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-black/40 p-1 text-white backdrop-blur"
    >
      {LOCALES.map((option) => (
        <Button
          key={option}
          variant={option === locale ? "default" : "ghost"}
          aria-pressed={option === locale}
          disabled={isPending}
          onClick={() => onSelect(option)}
          className={
            option === locale ? undefined : "text-white hover:bg-white/10 hover:text-white"
          }
        >
          {option.toUpperCase()}
        </Button>
      ))}
    </div>
  );
}
