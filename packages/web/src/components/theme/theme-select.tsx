"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { themeCookieValue, type Theme } from "@/lib/theme";

const THEMES: Theme[] = ["light", "dark", "system"];

/**
 * Selector de tema claro/oscuro/sistema, mismo patrón que `LocaleSwitcher`
 * (`variant="select"`). `initialTheme` es la preferencia guardada en la
 * cookie `theme` (ver `PublicFooter`).
 */
export function ThemeSelect({ id, initialTheme }: { id?: string; initialTheme: Theme }) {
  const t = useTranslations("ThemeToggle");
  const [theme, setTheme] = useState(initialTheme);

  function choose(next: Theme) {
    document.cookie = themeCookieValue(next);
    const dark =
      next === "dark" ||
      (next === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    setTheme(next);
  }

  return (
    <Select value={theme} onValueChange={(value) => choose(value as Theme)}>
      <SelectTrigger id={id} aria-label={t("label")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {THEMES.map((option) => (
          <SelectItem key={option} value={option}>
            {t(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
