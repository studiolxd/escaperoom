import { DEFAULT_LOCALE, LOCALES } from "@escaperoom/config/locales";
import { defineRouting } from "next-intl/routing";

/**
 * Routing de locales (ADR-018, specs/03 §1): la lista vive en
 * `@escaperoom/config` para no duplicarla. `es` es el idioma por defecto y el
 * prefijo se mantiene siempre (`/es`, `/es/rooms`).
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
  // Redirección determinista de "/" al idioma por defecto (sin negociación
  // por Accept-Language): el selector de idioma es el que manda.
  localeDetection: false,
});
