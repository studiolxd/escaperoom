import * as Y from "yjs";
import { pickLanguages, type LocalizedText } from "@escaperoom/shared/schemas";

/**
 * `LocalizedText` (specs/08 §2.2) dentro del doc Yjs del editor.
 *
 * Forma en el doc: `Y.Map<locale, Y.Map>` y, por locale, `{ text: Y.Text,
 * audioUrl?: string }`. El texto es un `Y.Text` (no un string) para que dos
 * creadores editando el mismo idioma a la vez mezclen carácter a carácter en
 * vez de pisarse; cada idioma es una entrada independiente, así que editar el
 * `en` nunca toca el `es`.
 */
export type YLocalizedText = Y.Map<Y.Map<unknown>>;

const TEXT_KEY = "text";
const AUDIO_KEY = "audioUrl";

function createEntry(text: string, audioUrl?: string): Y.Map<unknown> {
  const entry = new Y.Map<unknown>();
  entry.set(TEXT_KEY, new Y.Text(text));
  if (audioUrl !== undefined) entry.set(AUDIO_KEY, audioUrl);
  return entry;
}

/** Crea el tipo Yjs de un `LocalizedText` (aún sin integrar en un doc). */
export function createYLocalizedText(value: LocalizedText = {}): YLocalizedText {
  const y: YLocalizedText = new Y.Map();
  for (const [locale, entry] of Object.entries(value)) {
    y.set(locale, createEntry(entry.text, entry.audioUrl));
  }
  return y;
}

function textOf(entry: Y.Map<unknown> | undefined): Y.Text | undefined {
  const text = entry?.get(TEXT_KEY);
  return text instanceof Y.Text ? text : undefined;
}

/** Texto de un idioma ("" si no hay entrada). */
export function getLocalizedValue(y: YLocalizedText, locale: string): string {
  return textOf(y.get(locale))?.toString() ?? "";
}

/**
 * Reemplaza el texto de un idioma aplicando solo la diferencia (prefijo y
 * sufijo comunes) sobre el `Y.Text`, de modo que una edición local no borra lo
 * que otro creador escribió a la vez en otra parte del mismo texto.
 */
export function setLocalizedValue(y: YLocalizedText, locale: string, value: string): void {
  const apply = () => {
    const text = textOf(y.get(locale));
    if (!text) {
      y.set(locale, createEntry(value));
      return;
    }
    const current = text.toString();
    if (current === value) return;
    let start = 0;
    const max = Math.min(current.length, value.length);
    while (start < max && current[start] === value[start]) start++;
    let end = 0;
    while (
      end < max - start &&
      current[current.length - 1 - end] === value[value.length - 1 - end]
    ) {
      end++;
    }
    const removed = current.length - start - end;
    if (removed > 0) text.delete(start, removed);
    const inserted = value.slice(start, value.length - end);
    if (inserted.length > 0) text.insert(start, inserted);
  };
  if (y.doc) y.doc.transact(apply);
  else apply();
}

/** Fija (o quita, con `undefined`) el audio de un idioma (specs/15 §1). */
export function setLocalizedAudioUrl(
  y: YLocalizedText,
  locale: string,
  audioUrl: string | undefined,
): void {
  const entry = y.get(locale);
  if (!entry) {
    if (audioUrl !== undefined) y.set(locale, createEntry("", audioUrl));
    return;
  }
  if (audioUrl === undefined) entry.delete(AUDIO_KEY);
  else entry.set(AUDIO_KEY, audioUrl);
}

/** Borra por completo la entrada de un idioma (texto y audio). */
export function deleteLocalizedEntry(y: YLocalizedText, locale: string): boolean {
  if (!y.has(locale)) return false;
  y.delete(locale);
  return true;
}

/**
 * Serializa a `LocalizedText`. Con `languages`, solo los idiomas declarados y
 * en su orden (lo que se empaqueta al publicar); sin él, todas las entradas.
 */
export function yLocalizedTextToJSON(
  y: YLocalizedText,
  languages?: readonly string[],
): LocalizedText {
  const out: LocalizedText = {};
  y.forEach((entry, locale) => {
    const audioUrl = entry.get(AUDIO_KEY);
    out[locale] = {
      text: textOf(entry)?.toString() ?? "",
      ...(typeof audioUrl === "string" ? { audioUrl } : {}),
    };
  });
  return languages ? pickLanguages(out, languages) : out;
}
