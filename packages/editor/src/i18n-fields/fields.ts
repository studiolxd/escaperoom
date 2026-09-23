import * as Y from "yjs";
import {
  missingTranslations,
  type DialogDef,
  type HintDef,
  type LocalizedText,
} from "@escaperoom/shared/schemas";
import { createYLocalizedText, yLocalizedTextToJSON, type YLocalizedText } from "./localized-text";

/**
 * Campos `LocalizedText` del doc Yjs. Cada colección es un `Y.Map` raíz
 * indexado por id (`dialogs`, `hints`, `items`) cuyas entradas son `Y.Map` con
 * las propiedades de la definición de specs/08 §2.3–2.4; la propiedad
 * localizada es un `YLocalizedText`.
 */
export const LOCALIZED_FIELDS = [
  { collection: "dialogs", field: "text" },
  { collection: "hints", field: "text" },
  { collection: "items", field: "name" },
] as const;

export type LocalizedCollection = (typeof LOCALIZED_FIELDS)[number]["collection"];

export type LocalizedFieldRef = {
  collection: LocalizedCollection;
  id: string;
  field: string;
  text: YLocalizedText;
};

function fieldOf(collection: LocalizedCollection): string {
  return LOCALIZED_FIELDS.find((f) => f.collection === collection)?.field ?? "text";
}

function collectionMap(doc: Y.Doc, collection: LocalizedCollection): Y.Map<Y.Map<unknown>> {
  return doc.getMap(collection);
}

/** Recorre todos los campos localizados del doc (en orden de colección e id). */
export function forEachLocalizedField(doc: Y.Doc, fn: (ref: LocalizedFieldRef) => void): void {
  for (const { collection, field } of LOCALIZED_FIELDS) {
    const map = collectionMap(doc, collection);
    for (const id of [...map.keys()].sort()) {
      const text = map.get(id)?.get(field);
      if (text instanceof Y.Map) fn({ collection, id, field, text: text as YLocalizedText });
    }
  }
}

/**
 * Devuelve el campo localizado de una entrada, creando entrada y campo si no
 * existen. `props` fija el resto de propiedades planas (p. ej. `puzzleId`).
 */
export function ensureLocalizedField(
  doc: Y.Doc,
  collection: LocalizedCollection,
  id: string,
  initial: LocalizedText = {},
  props: Record<string, unknown> = {},
): YLocalizedText {
  const field = fieldOf(collection);
  let result: YLocalizedText | undefined;
  doc.transact(() => {
    const map = collectionMap(doc, collection);
    let record = map.get(id);
    if (!record) {
      record = new Y.Map<unknown>();
      map.set(id, record);
    }
    record.set("id", id);
    for (const [key, value] of Object.entries(props)) record.set(key, value);
    const existing = record.get(field);
    if (existing instanceof Y.Map) {
      result = existing as YLocalizedText;
    } else {
      result = createYLocalizedText(initial);
      record.set(field, result);
    }
  });
  if (!result) throw new Error("ensureLocalizedField: no se pudo crear el campo");
  return result;
}

/** Campo localizado de una entrada existente, o `undefined`. */
export function getLocalizedField(
  doc: Y.Doc,
  collection: LocalizedCollection,
  id: string,
): YLocalizedText | undefined {
  const text = collectionMap(doc, collection).get(id)?.get(fieldOf(collection));
  return text instanceof Y.Map ? (text as YLocalizedText) : undefined;
}

export type MissingTranslation = {
  collection: LocalizedCollection;
  id: string;
  field: string;
  /** Idiomas declarados sin texto (vacío o solo espacios), en orden de `languages`. */
  missing: string[];
};

/** Campos a los que les falta traducción en algún idioma declarado. */
export function findMissingTranslations(
  doc: Y.Doc,
  languages: readonly string[],
): MissingTranslation[] {
  const out: MissingTranslation[] = [];
  forEachLocalizedField(doc, ({ collection, id, field, text }) => {
    const missing = missingTranslations(yLocalizedTextToJSON(text), languages);
    if (missing.length > 0) out.push({ collection, id, field, missing });
  });
  return out;
}

function plain(record: Y.Map<unknown>, key: string): unknown {
  const value = record.get(key);
  return value instanceof Y.AbstractType ? value.toJSON() : value;
}

/** `dialogs` del doc como `DialogDef[]`, con el texto limitado a `languages`. */
export function serializeDialogs(doc: Y.Doc, languages: readonly string[]): DialogDef[] {
  const out: DialogDef[] = [];
  const map = collectionMap(doc, "dialogs");
  for (const id of [...map.keys()].sort()) {
    const text = getLocalizedField(doc, "dialogs", id);
    const conditions = plain(map.get(id) ?? new Y.Map(), "conditions");
    out.push({
      id,
      text: text ? yLocalizedTextToJSON(text, languages) : {},
      ...(Array.isArray(conditions) ? { conditions: conditions as DialogDef["conditions"] } : {}),
    });
  }
  return out;
}

/** `hints` del doc como `HintDef[]`, con el texto limitado a `languages`. */
export function serializeHints(doc: Y.Doc, languages: readonly string[]): HintDef[] {
  const out: HintDef[] = [];
  const map = collectionMap(doc, "hints");
  for (const id of [...map.keys()].sort()) {
    const record = map.get(id) ?? new Y.Map();
    const text = getLocalizedField(doc, "hints", id);
    out.push({
      id,
      puzzleId: String(plain(record, "puzzleId") ?? ""),
      tier: Number(plain(record, "tier") ?? 1),
      cost: Number(plain(record, "cost") ?? 0),
      text: text ? yLocalizedTextToJSON(text, languages) : {},
    });
  }
  return out;
}
