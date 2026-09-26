import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MAX_INTRO_TEXT_LENGTH,
  parseRoomPackage,
  type RoomPackage,
} from "@escaperoom/shared/schemas";
import { validateRoomPackage } from "@escaperoom/shared/validator";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  RoomDocError,
  addLobbyRoom,
  addRoomLanguage,
  findLobbyRoomId,
  getRoomIntroText,
  initRoomDoc,
  readRoomIntro,
  removeRoomLanguage,
  roomDocToPackage,
  roomPackageToDoc,
  setLocalizedValue,
  setRoomIntro,
  setRoomIntroSubtitles,
  setSubRoomKind,
} from "../src";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const fixtureJson = readFileSync(fixturePath, "utf8");
const fixture: RoomPackage = parseRoomPackage(JSON.parse(fixtureJson) as unknown);

const VIDEO = "media:3f1c1b8e-2d7a-4a57-9c1f-6f5f0b4c2a11";
const VTT_ES = "media:0b8f6a3e-54a1-4c3e-8a0e-9d2b7c1f4e22";
const VTT_EN = "media:9a7d2c41-7e3b-4f6a-b1c2-3d4e5f6a7b33";

/** El Rey Aldric con un segundo idioma declarado (`en`). */
function bilingualDoc(): Y.Doc {
  const doc = roomPackageToDoc(fixture);
  addRoomLanguage(doc, "en");
  return doc;
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof RoomDocError ? error.code : String(error);
  }
  return undefined;
}

describe("serialización: kind de la subroom y meta.intro", () => {
  it("el Rey Aldric (sin lobby ni intro) hace ida y vuelta byte a byte", () => {
    const pkg = roomDocToPackage(roomPackageToDoc(fixture));
    expect(pkg).toEqual(fixture);
    expect(JSON.stringify(pkg.map)).toBe(JSON.stringify(fixture.map));
    expect(pkg.meta).not.toHaveProperty("intro");
    expect(pkg.map.rooms.every((room) => !("kind" in room))).toBe(true);
  });

  it("conserva kind: lobby y una intro de texto en la ida y vuelta", () => {
    const lobby = { ...fixture.map.rooms[1]!, id: "sala-espera", kind: "lobby" as const };
    const withLobby: RoomPackage = {
      ...fixture,
      meta: {
        ...fixture.meta,
        languages: ["es", "en"],
        intro: { type: "text", text: { es: { text: "Hola" }, en: { text: "Hi" } } },
      },
      map: { ...fixture.map, rooms: [...fixture.map.rooms, { ...lobby, decorations: [] }] },
    };
    const pkg = roomDocToPackage(roomPackageToDoc(withLobby));
    expect(pkg).toEqual(withLobby);
    expect(Object.keys(pkg.map.rooms.at(-1)!).slice(0, 3)).toEqual(["id", "name", "kind"]);
  });

  it("conserva una intro de vídeo con subtítulos", () => {
    const pkg: RoomPackage = {
      ...fixture,
      meta: { ...fixture.meta, intro: { type: "video", video: VIDEO, subtitles: { es: VTT_ES } } },
    };
    expect(roomDocToPackage(roomPackageToDoc(pkg)).meta.intro).toEqual(pkg.meta.intro);
  });
});

describe("setSubRoomKind", () => {
  it("marca y desmarca una habitación como lobby", () => {
    const doc = roomPackageToDoc(fixture);
    setSubRoomKind(doc, "catacumbas", "lobby");
    expect(findLobbyRoomId(doc)).toBe("catacumbas");
    expect(roomDocToPackage(doc).map.rooms.find((r) => r.id === "catacumbas")?.kind).toBe("lobby");
    setSubRoomKind(doc, "catacumbas", undefined);
    expect(findLobbyRoomId(doc)).toBeUndefined();
    expect(roomDocToPackage(doc)).toEqual(fixture);
  });

  it("rechaza un segundo lobby con un error claro", () => {
    const doc = roomPackageToDoc(fixture);
    setSubRoomKind(doc, "catacumbas", "lobby");
    expect(() => setSubRoomKind(doc, "bodega", "lobby")).toThrow(/Ya hay una sala de espera/);
    expect(code(() => setSubRoomKind(doc, "bodega", "lobby"))).toBe("LOBBY_CONFLICT");
    // Volver a marcar el mismo es idempotente.
    expect(code(() => setSubRoomKind(doc, "catacumbas", "lobby"))).toBeUndefined();
  });

  it("rechaza convertir la única habitación en lobby y las habitaciones desconocidas", () => {
    const doc = new Y.Doc();
    initRoomDoc(doc, { id: "r", title: "Sala", language: "es" });
    expect(code(() => setSubRoomKind(doc, "sala-1", "lobby"))).toBe("LOBBY_CONFLICT");
    expect(code(() => setSubRoomKind(doc, "nope", "lobby"))).toBe("UNKNOWN_ROOM");
  });
});

describe("addLobbyRoom", () => {
  it("crea la sala de espera al final, con suelo, muros y spawns, y la sala sigue siendo válida", () => {
    const doc = roomPackageToDoc(fixture);
    const id = addLobbyRoom(doc, { cols: 8, rows: 6 });
    expect(id).toBe("lobby");
    const pkg = roomDocToPackage(doc);
    const lobby = pkg.map.rooms.at(-1)!;
    expect(lobby).toMatchObject({
      id: "lobby",
      name: "Sala de espera",
      kind: "lobby",
      grid: { cols: 8, rows: 6 },
      decorations: [],
    });
    expect(lobby.layers.map((layer) => layer.name)).toEqual(["ground", "walls"]);
    expect(lobby.spawnPoints).toHaveLength(fixture.meta.players.max);
    const cells = new Set(lobby.spawnPoints.map((s) => `${s.x},${s.y}`));
    expect(cells.size).toBe(lobby.spawnPoints.length);
    for (const spawn of lobby.spawnPoints) {
      expect(spawn.x).toBeGreaterThanOrEqual(1);
      expect(spawn.y).toBeGreaterThanOrEqual(1);
      expect(spawn.x).toBeLessThan(8);
      expect(spawn.y).toBeLessThan(6);
    }
    // La habitación inicial sigue siendo la primera de juego.
    expect(pkg.map.rooms[0]?.id).toBe(fixture.map.rooms[0]?.id);
    expect(validateRoomPackage(parseRoomPackage(pkg)).ok).toBe(true);
  });

  it("acepta id y nombre propios y rechaza un segundo lobby o tamaños inválidos", () => {
    const doc = roomPackageToDoc(fixture);
    expect(addLobbyRoom(doc, { id: "vestibulo", name: "Vestíbulo", cols: 5, rows: 5 })).toBe(
      "vestibulo",
    );
    expect(code(() => addLobbyRoom(doc, { cols: 5, rows: 5 }))).toBe("LOBBY_CONFLICT");
    const other = roomPackageToDoc(fixture);
    expect(code(() => addLobbyRoom(other, { cols: 2, rows: 5 }))).toBe("INVALID_VALUE");
    expect(code(() => addLobbyRoom(other, { cols: 5, rows: 5.5 }))).toBe("INVALID_VALUE");
    expect(code(() => addLobbyRoom(other, { id: "salon-trono", cols: 5, rows: 5 }))).toBe(
      "DUPLICATE_ID",
    );
    expect(findLobbyRoomId(other)).toBeUndefined();
  });
});

describe("introducción (meta.intro)", () => {
  it("texto localizado: se fija, se edita como YLocalizedText y se quita", () => {
    const doc = bilingualDoc();
    setRoomIntro(doc, { type: "text", text: { es: { text: "Bienvenidos" } } });
    const text = getRoomIntroText(doc);
    expect(text).toBeDefined();
    setLocalizedValue(text!, "en", "Welcome");
    expect(readRoomIntro(doc)).toEqual({
      type: "text",
      text: { es: { text: "Bienvenidos" }, en: { text: "Welcome" } },
    });
    expect(roomDocToPackage(doc).meta.intro).toEqual(readRoomIntro(doc));
    setRoomIntro(doc, null);
    expect(readRoomIntro(doc)).toBeUndefined();
    expect(roomDocToPackage(doc).meta).not.toHaveProperty("intro");
  });

  it("rechaza idiomas no declarados, texto vacío de idiomas y textos demasiado largos", () => {
    const doc = roomPackageToDoc(fixture);
    expect(code(() => setRoomIntro(doc, { type: "text", text: {} }))).toBe("UNKNOWN_LANGUAGE");
    expect(code(() => setRoomIntro(doc, { type: "text", text: { fr: { text: "Salut" } } }))).toBe(
      "UNKNOWN_LANGUAGE",
    );
    const long = "x".repeat(MAX_INTRO_TEXT_LENGTH + 1);
    expect(code(() => setRoomIntro(doc, { type: "text", text: { es: { text: long } } }))).toBe(
      "INVALID_VALUE",
    );
    expect(readRoomIntro(doc)).toBeUndefined();
  });

  it("vídeo con subtítulos por idioma; cambiar a vídeo descarta el texto", () => {
    const doc = bilingualDoc();
    setRoomIntro(doc, { type: "text", text: { es: { text: "Hola" } } });
    setRoomIntro(doc, { type: "video", video: VIDEO });
    expect(getRoomIntroText(doc)).toBeUndefined();
    setRoomIntroSubtitles(doc, "es", VTT_ES);
    setRoomIntroSubtitles(doc, "en", VTT_EN);
    expect(readRoomIntro(doc)).toEqual({
      type: "video",
      video: VIDEO,
      subtitles: { es: VTT_ES, en: VTT_EN },
    });
    setRoomIntroSubtitles(doc, "en", null);
    expect(readRoomIntro(doc)).toEqual({ type: "video", video: VIDEO, subtitles: { es: VTT_ES } });
    expect(code(() => setRoomIntroSubtitles(doc, "fr", VTT_EN))).toBe("UNKNOWN_LANGUAGE");
    expect(code(() => setRoomIntro(doc, { type: "video", video: "" }))).toBe("INVALID_VALUE");
    expect(validateRoomPackage(roomDocToPackage(doc)).ok).toBe(true);
  });

  it("subtítulos sin vídeo: error claro", () => {
    const doc = roomPackageToDoc(fixture);
    expect(code(() => setRoomIntroSubtitles(doc, "es", VTT_ES))).toBe("INVALID_VALUE");
  });

  it("un idioma retirado deja sus textos/subtítulos en el borrador pero no se empaquetan", () => {
    const doc = roomPackageToDoc(fixture);
    addRoomLanguage(doc, "fr");
    setRoomIntro(doc, { type: "video", video: VIDEO, subtitles: { es: VTT_ES, fr: VTT_EN } });
    removeRoomLanguage(doc, "fr");
    expect(readRoomIntro(doc)).toEqual({ type: "video", video: VIDEO, subtitles: { es: VTT_ES } });
    addRoomLanguage(doc, "fr");
    expect(readRoomIntro(doc)).toMatchObject({ subtitles: { es: VTT_ES, fr: VTT_EN } });
  });

  it("dos creadores editando la intro a la vez convergen (Yjs)", () => {
    const a = bilingualDoc();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    setRoomIntro(a, { type: "video", video: VIDEO });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    setRoomIntroSubtitles(a, "es", VTT_ES);
    setRoomIntroSubtitles(b, "en", VTT_EN);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readRoomIntro(a)).toEqual(readRoomIntro(b));
    expect(readRoomIntro(a)).toMatchObject({ subtitles: { es: VTT_ES, en: VTT_EN } });
  });
});
