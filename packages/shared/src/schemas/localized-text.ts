import type { LocalizedText } from "./common";

/**
 * Helpers puros sobre `LocalizedText` y los idiomas de la sala (specs/08 §2.2).
 * No dependen de Yjs ni de React: los usan el editor (campos localizados) y el
 * catálogo (filtro por idioma). La resolución del texto a mostrar con fallback
 * vive en `hints/localized-text.ts` (`resolveLocalizedText`).
 */

/**
 * Código de idioma aceptado en `meta.languages`: subtag primario ISO 639 en
 * minúsculas (`es`, `en`, `ast`) con subtags opcionales al estilo BCP 47
 * (`pt-BR`, `zh-Hant`).
 */
const LANGUAGE_CODE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function isLanguageCode(value: string): boolean {
  return LANGUAGE_CODE_RE.test(value);
}

/** `true` si el locale tiene un texto no vacío (los espacios no cuentan). */
export function hasTranslation(text: LocalizedText | undefined, locale: string): boolean {
  const entry = text?.[locale];
  return entry !== undefined && entry.text.trim().length > 0;
}

/**
 * Idiomas declarados de la sala a los que les falta traducción en `text`, en el
 * orden de `languages`. Un texto vacío o solo con espacios cuenta como falta.
 */
export function missingTranslations(
  text: LocalizedText | undefined,
  languages: readonly string[],
): string[] {
  return languages.filter((locale) => !hasTranslation(text, locale));
}

/**
 * Copia de `text` con solo los idiomas declarados (en su orden). Es lo que se
 * empaqueta al publicar: las traducciones de un idioma retirado se conservan en
 * el borrador pero no viajan en el `RoomPackage`.
 */
export function pickLanguages(text: LocalizedText, languages: readonly string[]): LocalizedText {
  const out: LocalizedText = {};
  for (const locale of languages) {
    const entry = text[locale];
    if (entry) out[locale] = { ...entry };
  }
  return out;
}

/**
 * Semántica de `languages @> ARRAY[...]`: la sala incluye TODOS los idiomas
 * pedidos. Una petición vacía no filtra.
 */
export function includesAllLanguages(
  roomLanguages: readonly string[],
  requested: readonly string[],
): boolean {
  return requested.every((locale) => roomLanguages.includes(locale));
}
