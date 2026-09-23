import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRoomPackage, type RoomPackage, type SubRoom } from "@escaperoom/shared/schemas";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  EditToolController,
  addDecoration,
  addTorch,
  getAmbientLight,
  initRoomDoc,
  listDecorations,
  listLights,
  moveDecoration,
  removeDecoration,
  removeLight,
  roomDocToPackage,
  roomPackageToDoc,
  setAmbientLight,
  setDecorationSprite,
  setDecorations,
  setLighting,
  updateTorch,
} from "../src";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const fixture: RoomPackage = parseRoomPackage(
  JSON.parse(readFileSync(fixturePath, "utf8")) as unknown,
);

const roomOf = (pkg: RoomPackage, id: string): SubRoom => {
  const room = pkg.map.rooms.find((r) => r.id === id);
  if (!room) throw new Error(`sin habitación ${id}`);
  return room;
};

/** El Rey Aldric SIN decoración ni luces: lo que el creador tiene que poner. */
function bareAldric(): Y.Doc {
  return roomPackageToDoc({
    ...fixture,
    map: {
      ...fixture.map,
      rooms: fixture.map.rooms.map((room) => ({ ...room, decorations: [], lighting: [] })),
    },
  });
}

describe("comandos de decoración (SubRoom.decorations)", () => {
  it("colocar, mover, cambiar sprite y borrar se reflejan en roomDocToPackage", () => {
    const doc = bareAldric();
    expect(addDecoration(doc, "bodega", { sprite: "barriles", x: 1, y: 2 })).toBe(0);
    expect(addDecoration(doc, "bodega", { sprite: "barriles", x: 16, y: 2 })).toBe(1);
    expect(addDecoration(doc, "bodega", { sprite: "columna", x: 3, y: 3 })).toBe(2);
    expect(moveDecoration(doc, "bodega", 2, { x: 15, y: 8 })).toBe(true);
    expect(moveDecoration(doc, "bodega", 2, { x: 15, y: 8 })).toBe(false);
    setDecorationSprite(doc, "bodega", 2, "barril-suelto");
    removeDecoration(doc, "bodega", 1);

    expect(roomOf(roomDocToPackage(doc), "bodega").decorations).toEqual([
      { sprite: "barriles", x: 1, y: 2 },
      { sprite: "barril-suelto", x: 15, y: 8 },
    ]);
    expect(listDecorations(doc, "bodega")).toHaveLength(2);
    // Las demás habitaciones no se tocan.
    expect(roomOf(roomDocToPackage(doc), "salon-trono").decorations).toEqual([]);
  });

  it("valida habitación, celda, sprite e índice con códigos traducibles", () => {
    const doc = bareAldric();
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as { code?: string }).code;
      }
      return "OK";
    };
    expect(code(() => addDecoration(doc, "desvan", { sprite: "x", x: 0, y: 0 }))).toBe(
      "UNKNOWN_ROOM",
    );
    expect(code(() => addDecoration(doc, "bodega", { sprite: "x", x: 18, y: 0 }))).toBe(
      "OUT_OF_BOUNDS",
    );
    expect(code(() => addDecoration(doc, "bodega", { sprite: " ", x: 0, y: 0 }))).toBe(
      "INVALID_VALUE",
    );
    expect(code(() => moveDecoration(doc, "bodega", 0, { x: 1, y: 1 }))).toBe("UNKNOWN_DECORATION");
    expect(roomOf(roomDocToPackage(doc), "bodega").decorations).toEqual([]);
  });

  it("setDecorations sustituye la lista entera, en orden, y es idempotente", () => {
    const doc = bareAldric();
    const expected = roomOf(fixture, "salon-trono").decorations;
    addDecoration(doc, "salon-trono", { sprite: "vieja", x: 0, y: 0 });
    setDecorations(doc, "salon-trono", expected);
    expect(roomOf(roomDocToPackage(doc), "salon-trono").decorations).toEqual(expected);

    let updates = 0;
    doc.on("update", () => updates++);
    setDecorations(doc, "salon-trono", expected);
    expect(updates).toBe(0);
  });
});

describe("comandos de iluminación (SubRoom.lighting)", () => {
  it("antorchas por posición u objeto y luz ambiente reproducen el fixture", () => {
    const doc = bareAldric();
    // Salón: antorcha gobernada por el brasero + ambiente.
    addTorch(doc, "salon-trono", { x: 5, y: 1, objectId: "brasero" });
    setAmbientLight(doc, "salon-trono", { color: "#3a2f22", intensity: 0.6 });
    // Bodega: dos antorchas libres; la segunda se coloca mal y se mueve.
    addTorch(doc, "bodega", { x: 3, y: 1 });
    addTorch(doc, "bodega", { x: 4, y: 4, objectId: "mesa-catas" });
    updateTorch(doc, "bodega", 1, { x: 14, y: 1, objectId: null });
    setAmbientLight(doc, "bodega", { color: "#ffffff", intensity: 1 });
    // Cambiar el ambiente lo sustituye en su sitio (no añade otro).
    setAmbientLight(doc, "bodega", { color: "#2a1f16", intensity: 0.5 });
    // Catacumbas: una antorcha de más que se quita.
    addTorch(doc, "catacumbas", { x: 1, y: 1 });
    setAmbientLight(doc, "catacumbas", { color: "#1a1510", intensity: 0.45 });
    removeLight(doc, "catacumbas", 0);

    const pkg = roomDocToPackage(doc);
    for (const room of fixture.map.rooms) {
      expect(roomOf(pkg, room.id).lighting, room.id).toEqual(room.lighting);
    }
    expect(getAmbientLight(doc, "bodega")).toEqual({
      type: "ambient",
      color: "#2a1f16",
      intensity: 0.5,
    });
    setAmbientLight(doc, "bodega", null);
    expect(getAmbientLight(doc, "bodega")).toBeUndefined();
    expect(listLights(doc, "bodega")).toHaveLength(2);
  });

  it("rechaza objeto inexistente, color o intensidad fuera de rango y luces que no existen", () => {
    const doc = bareAldric();
    expect(() => addTorch(doc, "bodega", { x: 1, y: 1, objectId: "fantasma" })).toThrow(
      expect.objectContaining({ code: "UNKNOWN_OBJECT" }),
    );
    expect(() => setAmbientLight(doc, "bodega", { color: "rojo", intensity: 0.5 })).toThrow(
      expect.objectContaining({ code: "INVALID_VALUE" }),
    );
    expect(() => setAmbientLight(doc, "bodega", { color: "#ff0000", intensity: 2 })).toThrow(
      expect.objectContaining({ code: "INVALID_VALUE" }),
    );
    expect(() => updateTorch(doc, "bodega", 3, { x: 1 })).toThrow(
      expect.objectContaining({ code: "UNKNOWN_LIGHT" }),
    );
    setAmbientLight(doc, "bodega", { color: "#ff0000", intensity: 0.5 });
    expect(() => updateTorch(doc, "bodega", 0, { x: 1 })).toThrow(
      expect.objectContaining({ code: "UNKNOWN_LIGHT" }),
    );
    expect(() => addTorch(doc, "bodega", { x: 99, y: 1 })).toThrow(
      expect.objectContaining({ code: "OUT_OF_BOUNDS" }),
    );
    expect(listLights(doc, "bodega")).toEqual([
      { type: "ambient", color: "#ff0000", intensity: 0.5 },
    ]);
  });

  it("setLighting sustituye la lista entera y valida cada luz antes de escribir nada", () => {
    const doc = bareAldric();
    const expected = roomOf(fixture, "salon-trono").lighting;
    setLighting(doc, "salon-trono", expected);
    expect(roomOf(roomDocToPackage(doc), "salon-trono").lighting).toEqual(expected);
    expect(() =>
      setLighting(doc, "salon-trono", [{ type: "torch", x: 1, y: 1, objectId: "fantasma" }]),
    ).toThrow(expect.objectContaining({ code: "UNKNOWN_OBJECT" }));
    expect(roomOf(roomDocToPackage(doc), "salon-trono").lighting).toEqual(expected);
  });

  it("la ida y vuelta RoomPackage ⇄ doc sigue exacta tras editar y deshacer", () => {
    const doc = roomPackageToDoc(fixture);
    const index = addDecoration(doc, "catacumbas", { sprite: "columna", x: 5, y: 5 });
    removeDecoration(doc, "catacumbas", index);
    const light = addTorch(doc, "catacumbas", { x: 5, y: 5 });
    removeLight(doc, "catacumbas", light);
    expect(roomDocToPackage(doc)).toEqual(fixture);
  });

  it("una sala nueva empieza sin decoración ni luces y las admite", () => {
    const doc = new Y.Doc();
    initRoomDoc(doc, { id: "r", title: "Nueva", language: "es" });
    addDecoration(doc, "sala-1", { sprite: "columna", x: 0, y: 0 });
    setAmbientLight(doc, "sala-1", { color: "#101010", intensity: 0.3 });
    const room = roomOf(roomDocToPackage(doc), "sala-1");
    expect(room.decorations).toEqual([{ sprite: "columna", x: 0, y: 0 }]);
    expect(room.lighting).toEqual([{ type: "ambient", color: "#101010", intensity: 0.3 }]);
  });

  it("dos pestañas que decoran a la vez convergen sin perder entradas", () => {
    const a = bareAldric();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    addDecoration(a, "bodega", { sprite: "barriles", x: 1, y: 2 });
    addDecoration(b, "bodega", { sprite: "barril-suelto", x: 15, y: 8 });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    expect(listDecorations(a, "bodega")).toEqual(listDecorations(b, "bodega"));
    expect(listDecorations(a, "bodega")).toHaveLength(2);
  });
});

describe("controlador de herramientas: decorar y antorcha", () => {
  const down = (x: number, y: number, objectId?: string) =>
    ({ phase: "down", cell: { x, y }, ...(objectId ? { objectId } : {}) }) as const;

  it("decorar coloca el sprite de la palette como decoración, no como objeto", () => {
    const doc = bareAldric();
    const tools = new EditToolController(doc, { roomId: "bodega" });
    tools.selectDecorationSprite("barriles");
    expect(tools.getState()).toMatchObject({ tool: "decorate", sprite: "barriles" });
    tools.pointer(down(1, 2));
    // Con la herramienta ya en «decorar», elegir otro sprite sigue decorando.
    tools.selectSprite("barril-suelto");
    expect(tools.getState().tool).toBe("decorate");
    tools.pointer(down(15, 8));
    tools.pointer(down(40, 8)); // fuera de la rejilla: nada
    const pkg = roomDocToPackage(doc);
    expect(roomOf(pkg, "bodega").decorations).toEqual([
      { sprite: "barriles", x: 1, y: 2 },
      { sprite: "barril-suelto", x: 15, y: 8 },
    ]);
    expect(pkg.objects).toHaveLength(fixture.objects.length);
    expect(tools.getState().lastPlacedDecor).toEqual({
      kind: "decoration",
      roomId: "bodega",
      index: 1,
    });
    // Desde otra herramienta, elegir un sprite vuelve a colocar objetos.
    tools.setTool("select");
    tools.selectSprite("arca");
    expect(tools.getState().tool).toBe("place");
  });

  it("antorcha: en una celda vacía queda libre; sobre un objeto la gobierna él", () => {
    const doc = bareAldric();
    const tools = new EditToolController(doc, { roomId: "salon-trono" });
    tools.setTool("torch");
    tools.pointer(down(5, 1, "brasero"));
    tools.pointer(down(2, 2));
    tools.pointer(down(3, 3, "no-existe"));
    expect(roomOf(roomDocToPackage(doc), "salon-trono").lighting).toEqual([
      { type: "torch", x: 5, y: 1, objectId: "brasero" },
      { type: "torch", x: 2, y: 2 },
      { type: "torch", x: 3, y: 3 },
    ]);
  });
});
