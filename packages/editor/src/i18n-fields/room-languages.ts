import * as Y from "yjs";
import { isLanguageCode } from "@escaperoom/shared/schemas";
import { deleteLocalizedEntry, getLocalizedValue } from "./localized-text";
import { forEachLocalizedField } from "./fields";

/**
 * Idiomas de la sala en el doc Yjs (specs/08 §2.2): `meta.languages` es un
 * `Y.Array<string>` (dos creadores pueden añadir idiomas a la vez y ambos
 * sobreviven) y `meta.defaultLanguage` un string.
 *
 * Retirar un idioma NO borra sus traducciones: solo lo quita de `languages`.
 * Los textos quedan en el borrador (volver a añadir el idioma los recupera) y
 * no se empaquetan al publicar. Borrarlos de verdad es una operación aparte y
 * explícita (`purgeLanguageTranslations`) que la UI solo lanza tras confirmar.
 */

const META = "meta";
const LANGUAGES_KEY = "languages";
const DEFAULT_KEY = "defaultLanguage";

export type RoomLanguages = { languages: string[]; defaultLanguage: string | null };

export type RoomLanguageErrorCode =
  "INVALID_LANGUAGE" | "UNKNOWN_LANGUAGE" | "DEFAULT_LANGUAGE" | "LAST_LANGUAGE";

/** Error de dominio de la gestión de idiomas; la UI lo traduce a un aviso. */
export class RoomLanguageError extends Error {
  readonly code: RoomLanguageErrorCode;
  constructor(code: RoomLanguageErrorCode, message: string) {
    super(message);
    this.name = "RoomLanguageError";
    this.code = code;
  }
}

function meta(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(META);
}

function languagesArray(doc: Y.Doc): Y.Array<string> {
  const current = meta(doc).get(LANGUAGES_KEY);
  if (current instanceof Y.Array) return current as Y.Array<string>;
  const created = new Y.Array<string>();
  meta(doc).set(LANGUAGES_KEY, created);
  return created;
}

function assertLanguageCode(locale: string): void {
  if (!isLanguageCode(locale)) {
    throw new RoomLanguageError("INVALID_LANGUAGE", `Código de idioma no válido: "${locale}"`);
  }
}

/**
 * Idiomas declarados (sin duplicados, en orden de alta) e idioma por defecto.
 * Los duplicados solo aparecen si dos creadores añaden el mismo idioma a la vez.
 */
export function getRoomLanguages(doc: Y.Doc): RoomLanguages {
  const raw = meta(doc).get(LANGUAGES_KEY);
  const languages = raw instanceof Y.Array ? [...new Set(raw.toArray() as string[])] : [];
  const def = meta(doc).get(DEFAULT_KEY);
  return { languages, defaultLanguage: typeof def === "string" ? def : null };
}

/** Inicializa los idiomas de una sala nueva (sustituye los que hubiera). */
export function initRoomLanguages(doc: Y.Doc, languages: string[], defaultLanguage: string): void {
  languages.forEach(assertLanguageCode);
  const unique = [...new Set(languages)];
  if (!unique.includes(defaultLanguage)) {
    throw new RoomLanguageError(
      "UNKNOWN_LANGUAGE",
      `El idioma por defecto "${defaultLanguage}" no está entre los declarados`,
    );
  }
  doc.transact(() => {
    const array = new Y.Array<string>();
    array.push(unique);
    meta(doc).set(LANGUAGES_KEY, array);
    meta(doc).set(DEFAULT_KEY, defaultLanguage);
  });
}

/** Declara un idioma más. Si es el primero, pasa a ser el idioma por defecto. */
export function addRoomLanguage(doc: Y.Doc, locale: string): void {
  assertLanguageCode(locale);
  doc.transact(() => {
    const array = languagesArray(doc);
    if (!array.toArray().includes(locale)) array.push([locale]);
    if (getRoomLanguages(doc).defaultLanguage === null) meta(doc).set(DEFAULT_KEY, locale);
  });
}

/** Cambia el idioma por defecto a uno ya declarado. */
export function setDefaultLanguage(doc: Y.Doc, locale: string): void {
  if (!getRoomLanguages(doc).languages.includes(locale)) {
    throw new RoomLanguageError("UNKNOWN_LANGUAGE", `"${locale}" no es un idioma de la sala`);
  }
  meta(doc).set(DEFAULT_KEY, locale);
}

/** Cuántos campos localizados tienen texto en `locale` (para avisar antes de retirar). */
export function countTranslations(doc: Y.Doc, locale: string): number {
  let count = 0;
  forEachLocalizedField(doc, ({ text }) => {
    if (getLocalizedValue(text, locale).trim().length > 0) count++;
  });
  return count;
}

export type RemoveLanguageResult = {
  /** Traducciones que se CONSERVAN en el borrador (no se empaquetan al publicar). */
  retainedTranslations: number;
};

/**
 * Retira un idioma de `languages` sin borrar sus textos. No se puede retirar
 * el idioma por defecto (primero hay que elegir otro) ni el último idioma.
 */
export function removeRoomLanguage(doc: Y.Doc, locale: string): RemoveLanguageResult {
  const { languages, defaultLanguage } = getRoomLanguages(doc);
  if (!languages.includes(locale)) {
    throw new RoomLanguageError("UNKNOWN_LANGUAGE", `"${locale}" no es un idioma de la sala`);
  }
  if (languages.length === 1) {
    throw new RoomLanguageError("LAST_LANGUAGE", "La sala debe tener al menos un idioma");
  }
  if (locale === defaultLanguage) {
    throw new RoomLanguageError(
      "DEFAULT_LANGUAGE",
      "No se puede retirar el idioma por defecto; elige antes otro",
    );
  }
  doc.transact(() => {
    const array = languagesArray(doc);
    // De atrás adelante: borrar no desplaza los índices pendientes.
    const values = array.toArray();
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i] === locale) array.delete(i, 1);
    }
  });
  return { retainedTranslations: countTranslations(doc, locale) };
}

/**
 * Borra DE VERDAD las traducciones de un idioma NO declarado en todos los
 * campos localizados. Destructivo (aunque recuperable desde el historial de
 * 3.3): la UI solo lo llama tras una confirmación explícita.
 */
export function purgeLanguageTranslations(doc: Y.Doc, locale: string): number {
  if (getRoomLanguages(doc).languages.includes(locale)) {
    throw new RoomLanguageError(
      "UNKNOWN_LANGUAGE",
      `"${locale}" sigue declarado; retíralo antes de borrar sus textos`,
    );
  }
  let purged = 0;
  doc.transact(() => {
    forEachLocalizedField(doc, ({ text }) => {
      if (deleteLocalizedEntry(text, locale)) purged++;
    });
  });
  return purged;
}
