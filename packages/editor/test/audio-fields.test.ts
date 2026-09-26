import { createSilentMp3, libraryAudioRef } from "@escaperoom/shared/audio";
import { DialogDefSchema } from "@escaperoom/shared/schemas";
import {
  audioAssetRef,
  createAudioAssetService,
  createInMemoryAudioAssetStore,
  createInMemoryAudioBlobStore,
  type Actor,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  AudioFieldError,
  collectAudioRefs,
  collectAudioUsages,
  ensureLocalizedField,
  getEntryAudio,
  getLocalizedValue,
  getSoundEffects,
  initRoomLanguages,
  addRoomLanguage,
  removeRoomLanguage,
  removeSoundEffect,
  serializeDialogs,
  setEntryAudio,
  setSoundEffect,
} from "../src";

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

function roomDoc(): Y.Doc {
  const doc = new Y.Doc();
  initRoomLanguages(doc, ["es", "en"], "es");
  return doc;
}

const MUSIC = libraryAudioRef("music-dungeon-ambience");

describe("audio en diálogos y pistas", () => {
  it("se añade música de la biblioteca a un diálogo sin tocar su texto", () => {
    const doc = roomDoc();
    ensureLocalizedField(doc, "dialogs", "intro", { es: { text: "Bienvenidos." } });
    setEntryAudio(doc, "dialogs", "intro", "es", MUSIC);

    expect(getEntryAudio(doc, "dialogs", "intro", "es")).toBe(MUSIC);
    const [dialog] = serializeDialogs(doc, ["es", "en"]);
    expect(dialog?.text.es).toEqual({ text: "Bienvenidos.", audioUrl: MUSIC });
    // Sigue siendo un DialogDef válido: el formato RoomPackage no cambia.
    expect(DialogDefSchema.safeParse(dialog).success).toBe(true);
  });

  it("audio por idioma en un diálogo es/en", () => {
    const doc = roomDoc();
    const text = ensureLocalizedField(doc, "dialogs", "intro", {
      es: { text: "La puerta está cerrada." },
      en: { text: "The door is locked." },
    });
    const es = "upload:0f8fad5b-d9cb-469f-a165-70867728950e";
    const en = "upload:7c9e6679-7425-40de-944b-e07fc1f90ae7";
    setEntryAudio(doc, "dialogs", "intro", "es", es);
    setEntryAudio(doc, "dialogs", "intro", "en", en);

    expect(serializeDialogs(doc, ["es", "en"])[0]?.text).toEqual({
      es: { text: "La puerta está cerrada.", audioUrl: es },
      en: { text: "The door is locked.", audioUrl: en },
    });
    // Quitar el audio de un idioma no afecta al otro ni al texto.
    setEntryAudio(doc, "dialogs", "intro", "en", undefined);
    expect(getEntryAudio(doc, "dialogs", "intro", "en")).toBeUndefined();
    expect(getEntryAudio(doc, "dialogs", "intro", "es")).toBe(es);
    expect(getLocalizedValue(text, "en")).toBe("The door is locked.");
  });

  it("también en pistas, y valida idioma y referencia", () => {
    const doc = roomDoc();
    setEntryAudio(doc, "hints", "h1", "en", libraryAudioRef("sfx-success-chime"));
    expect(getEntryAudio(doc, "hints", "h1", "en")).toBe("library:sfx-success-chime");

    expect(() => setEntryAudio(doc, "dialogs", "intro", "fr", MUSIC)).toThrow(AudioFieldError);
    expect(() =>
      setEntryAudio(doc, "dialogs", "intro", "es", "https://cdn.example/x.mp3"),
    ).toThrow(/no válida/);
  });

  it("dos creadores ponen audio en idiomas distintos y convergen", () => {
    const a = roomDoc();
    const b = new Y.Doc();
    ensureLocalizedField(a, "dialogs", "intro", { es: { text: "Hola" }, en: { text: "Hi" } });
    sync(a, b);
    setEntryAudio(a, "dialogs", "intro", "es", MUSIC);
    setEntryAudio(b, "dialogs", "intro", "en", libraryAudioRef("sfx-door-creak"));
    sync(a, b);
    for (const doc of [a, b]) {
      expect(getEntryAudio(doc, "dialogs", "intro", "es")).toBe(MUSIC);
      expect(getEntryAudio(doc, "dialogs", "intro", "en")).toBe("library:sfx-door-creak");
    }
  });
});

describe("efectos de sonido", () => {
  it("se declaran por soundId y se listan", () => {
    const doc = roomDoc();
    setSoundEffect(doc, "fx-fuego", libraryAudioRef("sfx-door-creak"));
    setSoundEffect(doc, "fx-acierto", libraryAudioRef("sfx-success-chime"));
    expect(getSoundEffects(doc)).toEqual([
      { id: "fx-acierto", src: "library:sfx-success-chime" },
      { id: "fx-fuego", src: "library:sfx-door-creak" },
    ]);
    expect(removeSoundEffect(doc, "fx-fuego")).toBe(true);
    expect(getSoundEffects(doc)).toHaveLength(1);
    expect(() => setSoundEffect(doc, "Fx Mal", MUSIC)).toThrow(AudioFieldError);
  });
});

describe("referencias del borrador para publicar", () => {
  it("recoge solo el audio de idiomas declarados y los efectos", () => {
    const doc = roomDoc();
    addRoomLanguage(doc, "fr");
    setEntryAudio(doc, "dialogs", "intro", "es", MUSIC);
    setEntryAudio(doc, "dialogs", "intro", "fr", libraryAudioRef("sfx-door-creak"));
    setSoundEffect(doc, "fx-fuego", MUSIC);
    removeRoomLanguage(doc, "fr");

    expect(collectAudioUsages(doc, ["es", "en"])).toEqual([
      { kind: "entry", collection: "dialogs", id: "intro", locale: "es", ref: MUSIC },
      { kind: "sound", id: "fx-fuego", ref: MUSIC },
    ]);
    expect(collectAudioRefs(doc, ["es", "en"])).toEqual([MUSIC]);
    expect(collectAudioRefs(doc)).toHaveLength(2);
  });

  it("un MP3 propio es publicable al instante, sin moderación previa", async () => {
    const creator: Actor = { userId: "user-ana", organizationId: null, role: "member" };
    const service = createAudioAssetService({
      store: createInMemoryAudioAssetStore(),
      blobs: createInMemoryAudioBlobStore(),
    });
    const asset = await service.uploadAudio(creator, {
      filename: "narrador-es.mp3",
      contentType: "audio/mpeg",
      bytes: createSilentMp3(800),
      rightsDeclared: true,
    });

    const doc = roomDoc();
    ensureLocalizedField(doc, "dialogs", "intro", { es: { text: "Hola" } });
    setEntryAudio(doc, "dialogs", "intro", "es", audioAssetRef(asset));
    setSoundEffect(doc, "fx-fuego", MUSIC);

    const refs = collectAudioRefs(doc, ["es", "en"]);
    expect(await service.checkRefsForPublish(creator, refs)).toEqual([]);
  });
});
