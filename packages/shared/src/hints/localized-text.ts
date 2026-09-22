import type { LocalizedText } from "../schemas";

/**
 * Idioma de respaldo del proyecto (ADR-018: `es` es el idioma por defecto). Se
 * usa cuando un `LocalizedText` (specs/08 §2.2) no tiene entrada para el idioma
 * activo.
 */
export const DEFAULT_LOCALE = "es";

/** Entrada localizada ya resuelta, con el idioma del que proviene el texto. */
export interface ResolvedLocalizedEntry {
  /** Idioma finalmente usado (el pedido, el de respaldo o el primero). */
  locale: string;
  text: string;
  audioUrl?: string;
}

type LocalizedTextEntry = NonNullable<LocalizedText[string]>;

function toResolved(locale: string, entry: LocalizedTextEntry): ResolvedLocalizedEntry {
  return entry.audioUrl !== undefined
    ? { locale, text: entry.text, audioUrl: entry.audioUrl }
    : { locale, text: entry.text };
}

/**
 * Resuelve un `LocalizedText` al idioma pedido con cadena de fallback:
 * idioma activo → idioma de respaldo (`es`) → primera entrada disponible.
 *
 * Es lógica pura y nunca lanza: si el texto no tiene ninguna entrada devuelve
 * `text: ""`. El `locale` resultante indica de dónde salió el texto.
 */
export function resolveLocalizedEntry(
  text: LocalizedText,
  locale: string,
  fallbackLocale: string = DEFAULT_LOCALE,
): ResolvedLocalizedEntry {
  const preferred = text[locale];
  if (preferred) {
    return toResolved(locale, preferred);
  }

  if (fallbackLocale !== locale) {
    const fallback = text[fallbackLocale];
    if (fallback) {
      return toResolved(fallbackLocale, fallback);
    }
  }

  const firstKey = Object.keys(text)[0];
  const first = firstKey === undefined ? undefined : text[firstKey];
  if (firstKey !== undefined && first) {
    return toResolved(firstKey, first);
  }

  return { locale, text: "" };
}

/** Atajo de `resolveLocalizedEntry` que solo devuelve el texto resuelto. */
export function resolveLocalizedText(
  text: LocalizedText,
  locale: string,
  fallbackLocale: string = DEFAULT_LOCALE,
): string {
  return resolveLocalizedEntry(text, locale, fallbackLocale).text;
}
