import { DialogDefSchema, LocalizedTextSchema } from "@escaperoom/shared/schemas";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  RoomLanguageError,
  addRoomLanguage,
  countTranslations,
  ensureLocalizedField,
  findMissingTranslations,
  getLocalizedField,
  getLocalizedValue,
  getRoomLanguages,
  initRoomLanguages,
  purgeLanguageTranslations,
  removeRoomLanguage,
  serializeDialogs,
  serializeHints,
  setDefaultLanguage,
  setLocalizedAudioUrl,
  setLocalizedValue,
  yLocalizedTextToJSON,
} from "../src";

/** Sincroniza dos docs en ambos sentidos (como haría el proveedor de 3.3). */
function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

function roomDoc(languages = ["es", "en"], defaultLanguage = "es"): Y.Doc {
  const doc = new Y.Doc();
  initRoomLanguages(doc, languages, defaultLanguage);
  return doc;
}

describe("diálogo localizado en el doc Yjs", () => {
  it("se edita por idioma y se serializa como LocalizedText válido", () => {
    const doc = roomDoc();
    const text = ensureLocalizedField(doc, "dialogs", "intro");

    setLocalizedValue(text, "es", "La puerta está cerrada.");
    setLocalizedValue(text, "en", "The door is locked.");
    setLocalizedAudioUrl(text, "es", "audio/intro-es.mp3");
    // Editar un idioma no toca el otro.
    setLocalizedValue(text, "en", "The door is firmly locked.");

    expect(getLocalizedValue(text, "es")).toBe("La puerta está cerrada.");
    const json = yLocalizedTextToJSON(text);
    expect(json).toEqual({
      es: { text: "La puerta está cerrada.", audioUrl: "audio/intro-es.mp3" },
      en: { text: "The door is firmly locked." },
    });
    expect(LocalizedTextSchema.parse(json)).toEqual(json);

    const [dialog] = serializeDialogs(doc, getRoomLanguages(doc).languages);
    expect(DialogDefSchema.parse(dialog)).toEqual({ id: "intro", text: json });
  });

  it("sobrevive a la reconstrucción del doc desde updates binarios", () => {
    const doc = roomDoc();
    const text = ensureLocalizedField(doc, "dialogs", "intro", {
      es: { text: "Hola" },
      en: { text: "Hello" },
    });
    setLocalizedValue(text, "es", "Hola, viajero");

    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, Y.encodeStateAsUpdate(doc));
    expect(serializeDialogs(rebuilt, ["es", "en"])).toEqual([
      { id: "intro", text: { es: { text: "Hola, viajero" }, en: { text: "Hello" } } },
    ]);
  });

  it("dos creadores editando idiomas distintos (y el mismo texto) convergen", () => {
    const a = roomDoc();
    const b = new Y.Doc();
    sync(a, b);
    setLocalizedValue(ensureLocalizedField(a, "dialogs", "intro"), "es", "Bienvenido");
    sync(a, b);

    const textA = getLocalizedField(a, "dialogs", "intro");
    const textB = getLocalizedField(b, "dialogs", "intro");
    if (!textA || !textB) throw new Error("falta el campo sincronizado");
    setLocalizedValue(textB, "en", "Welcome");
    // Ediciones concurrentes en extremos distintos del mismo texto se mezclan.
    setLocalizedValue(textA, "es", "¡Bienvenido");
    setLocalizedValue(textB, "es", "Bienvenido!");
    sync(a, b);

    expect(yLocalizedTextToJSON(textA)).toEqual(yLocalizedTextToJSON(textB));
    expect(yLocalizedTextToJSON(textA)).toEqual({
      es: { text: "¡Bienvenido!" },
      en: { text: "Welcome" },
    });
  });
});

describe("traducciones faltantes", () => {
  it("marca los campos sin texto (o solo espacios) en algún idioma declarado", () => {
    const doc = roomDoc(["es", "en", "fr"]);
    ensureLocalizedField(doc, "dialogs", "completo", {
      es: { text: "Sí" },
      en: { text: "Yes" },
      fr: { text: "Oui" },
    });
    ensureLocalizedField(doc, "dialogs", "a-medias", {
      es: { text: "Solo español" },
      en: { text: "  " },
    });
    ensureLocalizedField(
      doc,
      "hints",
      "pista-1",
      { en: { text: "Look up" } },
      {
        puzzleId: "candado",
        tier: 1,
        cost: 1,
      },
    );

    expect(findMissingTranslations(doc, getRoomLanguages(doc).languages)).toEqual([
      { collection: "dialogs", id: "a-medias", field: "text", missing: ["en", "fr"] },
      { collection: "hints", id: "pista-1", field: "text", missing: ["es", "fr"] },
    ]);
    expect(serializeHints(doc, ["en"])).toEqual([
      { id: "pista-1", puzzleId: "candado", tier: 1, cost: 1, text: { en: { text: "Look up" } } },
    ]);
  });

  it("añadir un idioma hace aparecer como faltantes todos los campos", () => {
    const doc = roomDoc(["es"]);
    ensureLocalizedField(doc, "dialogs", "intro", { es: { text: "Hola" } });
    expect(findMissingTranslations(doc, getRoomLanguages(doc).languages)).toEqual([]);

    addRoomLanguage(doc, "de");
    expect(getRoomLanguages(doc)).toEqual({ languages: ["es", "de"], defaultLanguage: "es" });
    expect(findMissingTranslations(doc, getRoomLanguages(doc).languages)).toEqual([
      { collection: "dialogs", id: "intro", field: "text", missing: ["de"] },
    ]);
  });
});

describe("idiomas de la sala", () => {
  it("retirar un idioma conserva sus textos en el borrador pero no los empaqueta", () => {
    const doc = roomDoc(["es", "en"]);
    ensureLocalizedField(doc, "dialogs", "intro", { es: { text: "Hola" }, en: { text: "Hello" } });

    expect(removeRoomLanguage(doc, "en")).toEqual({ retainedTranslations: 1 });
    expect(getRoomLanguages(doc).languages).toEqual(["es"]);
    expect(serializeDialogs(doc, ["es"])).toEqual([
      { id: "intro", text: { es: { text: "Hola" } } },
    ]);

    // Volver a añadirlo recupera la traducción.
    addRoomLanguage(doc, "en");
    expect(serializeDialogs(doc, getRoomLanguages(doc).languages)[0]?.text).toEqual({
      es: { text: "Hola" },
      en: { text: "Hello" },
    });
  });

  it("borrar los textos es explícito y solo para idiomas ya retirados", () => {
    const doc = roomDoc(["es", "en"]);
    ensureLocalizedField(doc, "dialogs", "intro", { es: { text: "Hola" }, en: { text: "Hello" } });

    expect(() => purgeLanguageTranslations(doc, "en")).toThrow(RoomLanguageError);
    removeRoomLanguage(doc, "en");
    expect(purgeLanguageTranslations(doc, "en")).toBe(1);
    expect(countTranslations(doc, "en")).toBe(0);
  });

  it("no deja retirar el idioma por defecto ni el último", () => {
    const doc = roomDoc(["es", "en"]);
    expect(() => removeRoomLanguage(doc, "es")).toThrow(
      expect.objectContaining({ code: "DEFAULT_LANGUAGE" }),
    );
    setDefaultLanguage(doc, "en");
    removeRoomLanguage(doc, "es");
    expect(() => removeRoomLanguage(doc, "en")).toThrow(
      expect.objectContaining({ code: "LAST_LANGUAGE" }),
    );
    expect(() => removeRoomLanguage(doc, "fr")).toThrow(
      expect.objectContaining({ code: "UNKNOWN_LANGUAGE" }),
    );
  });

  it("valida códigos y deduplica altas concurrentes del mismo idioma", () => {
    const a = roomDoc(["es"]);
    expect(() => addRoomLanguage(a, "Español")).toThrow(
      expect.objectContaining({ code: "INVALID_LANGUAGE" }),
    );
    const b = new Y.Doc();
    sync(a, b);
    addRoomLanguage(a, "en");
    addRoomLanguage(b, "en");
    addRoomLanguage(b, "pt-BR");
    sync(a, b);
    expect(getRoomLanguages(a).languages.sort()).toEqual(["en", "es", "pt-BR"]);
    expect(getRoomLanguages(b)).toEqual(getRoomLanguages(a));

    // Retirar elimina también el duplicado concurrente.
    removeRoomLanguage(a, "en");
    expect(getRoomLanguages(a).languages).not.toContain("en");
  });
});
