"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { LOCALES, type Locale } from "@escaperoom/config/locales";
import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * Selector de idioma (patrón de next-intl): conserva la ruta actual y cambia
 * solo el segmento de locale. Usa el `Button` de shadcn con contraste suficiente
 * en reposo y en hover sobre el overlay oscuro (ADR-019).
 */
export function LocaleSwitcher() {
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
          size="xs"
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
