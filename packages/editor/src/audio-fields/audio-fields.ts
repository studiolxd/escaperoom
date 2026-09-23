import * as Y from "yjs";
import { parseAudioRef } from "@escaperoom/shared/audio";
import { ensureLocalizedField, getLocalizedField } from "../i18n-fields/fields";
import { setLocalizedAudioUrl, yLocalizedTextToJSON } from "../i18n-fields/localized-text";
import { getRoomLanguages } from "../i18n-fields/room-languages";

/**
 * Campos de audio del editor (ticket 3.11, specs/15 §1, specs/08 §2.2):
 *
 * - **Diálogos y pistas**: audio POR IDIOMA en `LocalizedText.audioUrl`, sobre
 *   los mismos `YLocalizedText` de 3.10 (el narrador en `es` y en `en` son
 *   ficheros distintos).
 * - **Efectos de sonido**: `Y.Map` raíz `sounds` indexado por `soundId` (lo que
 *   referencia la acción `play_sound` de las reglas), con `{ id, src }`. No son
 *   localizados.
 *
 * Lo que se guarda es una referencia estable (`library:<id>` / `upload:<uuid>`,
 * ver `@escaperoom/shared/audio`), nunca una URL firmada. Si el audio subido es
 * usable (dueño, moderación) lo decide el servicio `createAudioAssetService`.
 */

export const AUDIO_COLLECTIONS = ["dialogs", "hints"] as const;
export type AudioCollection = (typeof AUDIO_COLLECTIONS)[number];

const SOUNDS = "sounds";
const SOUND_ID_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export type AudioFieldErrorCode = "INVALID_AUDIO_REF" | "UNKNOWN_LANGUAGE" | "INVALID_SOUND_ID";

/** Error de dominio de los campos de audio; la UI lo traduce a un aviso. */
export class AudioFieldError extends Error {
  readonly code: AudioFieldErrorCode;
  constructor(code: AudioFieldErrorCode, message: string) {
    super(message);
    this.name = "AudioFieldError";
    this.code = code;
  }
}

function assertRef(ref: string): void {
  if (!parseAudioRef(ref)) {
    throw new AudioFieldError("INVALID_AUDIO_REF", `Referencia de audio no válida: "${ref}"`);
  }
}

/**
 * Fija (o quita, con `undefined`) el audio de un diálogo o pista en un idioma
 * declarado de la sala. Crea la entrada si no existe; el texto no se toca.
 */
export function setEntryAudio(
  doc: Y.Doc,
  collection: AudioCollection,
  id: string,
  locale: string,
  ref: string | undefined,
): void {
  if (ref !== undefined) assertRef(ref);
  if (!getRoomLanguages(doc).languages.includes(locale)) {
    throw new AudioFieldError("UNKNOWN_LANGUAGE", `"${locale}" no es un idioma de la sala`);
  }
  doc.transact(() => {
    const text =
      ref === undefined
        ? getLocalizedField(doc, collection, id)
        : ensureLocalizedField(doc, collection, id);
    if (text) setLocalizedAudioUrl(text, locale, ref);
  });
}

/** Audio de un diálogo o pista en un idioma, o `undefined`. */
export function getEntryAudio(
  doc: Y.Doc,
  collection: AudioCollection,
  id: string,
  locale: string,
): string | undefined {
  const text = getLocalizedField(doc, collection, id);
  return text ? yLocalizedTextToJSON(text)[locale]?.audioUrl : undefined;
}

export type SoundEffect = { id: string; src: string };

function soundsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(SOUNDS);
}

/** Declara o cambia el efecto `soundId` (el que usa `play_sound`). */
export function setSoundEffect(doc: Y.Doc, soundId: string, ref: string): void {
  if (!SOUND_ID_RE.test(soundId)) {
    throw new AudioFieldError("INVALID_SOUND_ID", `Id de efecto no válido: "${soundId}"`);
  }
  assertRef(ref);
  doc.transact(() => {
    const map = soundsMap(doc);
    let record = map.get(soundId);
    if (!record) {
      record = new Y.Map<unknown>();
      map.set(soundId, record);
    }
    record.set("id", soundId);
    record.set("src", ref);
  });
}

export function removeSoundEffect(doc: Y.Doc, soundId: string): boolean {
  const map = soundsMap(doc);
  if (!map.has(soundId)) return false;
  map.delete(soundId);
  return true;
}

/** Efectos declarados, ordenados por id. */
export function getSoundEffects(doc: Y.Doc): SoundEffect[] {
  const map = soundsMap(doc);
  return [...map.keys()]
    .sort()
    .flatMap((id) => {
      const src = map.get(id)?.get("src");
      return typeof src === "string" ? [{ id, src }] : [];
    });
}

export type AudioUsage =
  | { kind: "entry"; collection: AudioCollection; id: string; locale: string; ref: string }
  | { kind: "sound"; id: string; ref: string };

/**
 * Todas las referencias de audio del borrador con su ubicación. Con
 * `languages`, solo las de idiomas declarados (lo que se empaqueta al publicar;
 * el audio de un idioma retirado se conserva pero no se publica, como en 3.10).
 */
export function collectAudioUsages(doc: Y.Doc, languages?: readonly string[]): AudioUsage[] {
  const out: AudioUsage[] = [];
  for (const collection of AUDIO_COLLECTIONS) {
    const map = doc.getMap<Y.Map<unknown>>(collection);
    for (const id of [...map.keys()].sort()) {
      const text = getLocalizedField(doc, collection, id);
      if (!text) continue;
      for (const [locale, entry] of Object.entries(yLocalizedTextToJSON(text, languages))) {
        if (entry.audioUrl) out.push({ kind: "entry", collection, id, locale, ref: entry.audioUrl });
      }
    }
  }
  for (const sound of getSoundEffects(doc)) {
    out.push({ kind: "sound", id: sound.id, ref: sound.src });
  }
  return out;
}

/** Referencias distintas que la publicación debe comprobar (`checkRefsForPublish`). */
export function collectAudioRefs(doc: Y.Doc, languages?: readonly string[]): string[] {
  return [...new Set(collectAudioUsages(doc, languages).map((u) => u.ref))];
}
