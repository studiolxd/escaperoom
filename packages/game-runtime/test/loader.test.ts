import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RoomPackageLoadError,
  loadRoomPackage,
  loadRuntimeModel,
  toRuntimeModel,
  type RoomPackage,
} from "../src/loader";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);

function loadFixture(): unknown {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
}

function loadValidPackage(): RoomPackage {
  return loadRoomPackage(loadFixture());
}

describe("loadRoomPackage", () => {
  it("carga y valida el fixture del Rey Aldric", () => {
    const roomPackage = loadRoomPackage(loadFixture());

    expect(roomPackage.meta.id).toBe("room-rey-aldric");
    expect(roomPackage.meta.packageFormat).toBe("roompackage/v1");
    expect(roomPackage.map.rooms.map((room) => room.id)).toEqual([
      "salon-trono",
      "bodega",
      "catacumbas",
    ]);
  });

  it("acepta el documento como cadena JSON", () => {
    const json = readFileSync(fixturePath, "utf8");
    expect(loadRoomPackage(json).meta.id).toBe("room-rey-aldric");
  });

  it("falla con un error claro si el JSON no se puede parsear", () => {
    expect(() => loadRoomPackage("{")).toThrowError(RoomPackageLoadError);
    expect(() => loadRoomPackage("{")).toThrowError(/no se puede parsear/);
  });

  it("falla con la ruta del campo si el contrato no se cumple", () => {
    const invalid = loadValidPackage();
    delete (invalid.meta as { title?: string }).title;

    let error: unknown;
    try {
      loadRoomPackage(invalid);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RoomPackageLoadError);
    const loadError = error as RoomPackageLoadError;
    expect(loadError.message).toContain("meta.title");
    expect(loadError.issues.some((issue) => issue.path === "meta.title")).toBe(true);
  });

  it("rechaza valores que no son objetos", () => {
    expect(() => loadRoomPackage(42)).toThrowError(/se esperaba un objeto JSON/);
  });
});

describe("toRuntimeModel", () => {
  it("produce las 3 subrooms del Rey Aldric con sus capas, objetos, spawns y luces", () => {
    const model = toRuntimeModel(loadValidPackage());

    expect(model.subrooms).toHaveLength(3);
    expect(model.subrooms.map((room) => room.id)).toEqual(["salon-trono", "bodega", "catacumbas"]);

    for (const room of model.subrooms) {
      expect(room.layers.length).toBeGreaterThan(0);
      expect(room.spawns).toHaveLength(4);
      expect(room.lighting.length).toBeGreaterThan(0);
      expect(room.objects.length).toBeGreaterThan(0);
      const cells = room.width * room.height;
      for (const layer of room.layers) {
        expect(layer.tiles).toHaveLength(cells);
      }
    }

    const salon = model.subroomsById["salon-trono"];
    expect(salon?.objects).toHaveLength(14);
    expect(model.subroomsById["bodega"]?.objects).toHaveLength(8);
    expect(model.subroomsById["catacumbas"]?.objects).toHaveLength(6);
    expect(model.objects).toHaveLength(28);
  });

  it("resuelve el sprite del estado inicial y el mapa estado→sprite", () => {
    const model = toRuntimeModel(loadValidPackage());
    const cuadro = model.objectsById["cuadro-aurelio"];

    expect(cuadro?.initialState).toBe("closed");
    expect(cuadro?.sprite).toBe("cuadro-rey");
    expect(cuadro?.spriteByState).toEqual({
      closed: "cuadro-rey",
      open: "cuadro-rey-torcido",
    });
    expect(cuadro?.hidingSpot).toEqual({ contains: "llave-bronce" });

    const puerta = model.objectsById["puerta-bodega"];
    expect(puerta?.lockedBy).toBe("p-placas-estatuas");
    expect(puerta?.leadsTo).toBe("bodega");
  });

  it("expone items e itemsById con el nombre resuelto al idioma por defecto", () => {
    const model = toRuntimeModel(loadValidPackage());

    expect(model.locale).toBe("es");
    expect(model.items).toHaveLength(10);
    expect(model.itemsById["llave-bronce"]?.name).toBe("Llave de bronce");
  });

  it("expone diálogos e dialogsById resueltos con fallback de idioma", () => {
    const model = toRuntimeModel(loadValidPackage(), { locale: "en" });

    expect(model.locale).toBe("en");
    expect(model.dialogs).toHaveLength(14);
    expect(model.dialogsById["d-intro"]?.text).toContain("Profecía");
    expect(model.dialogsById["d-intro"]?.localized.es?.text).toContain("Profecía");
  });

  it("resume los puzzles sin filtrar secretos (code/solution)", () => {
    const model = toRuntimeModel(loadValidPackage());
    const candado = model.puzzlesById["p-candado-arca"];

    expect(model.puzzles).toHaveLength(9);
    expect(candado?.type).toBe("code_lock");
    expect(candado).not.toHaveProperty("code");
  });

  it("numera los spawns por orden de aparición", () => {
    const model = toRuntimeModel(loadValidPackage());
    const salon = model.subroomsById["salon-trono"];

    expect(salon?.spawns.map((spawn) => spawn.playerIndex)).toEqual([1, 2, 3, 4]);
  });

  it("normaliza capas RLE que no cubren la rejilla exacta", () => {
    const roomPackage = loadValidPackage();
    const room = roomPackage.map.rooms[0];
    const ground = room?.layers[0];
    if (!room || !ground) {
      throw new Error("el fixture no tiene la capa ground esperada");
    }
    ground.rle = [3, 1];

    const model = toRuntimeModel(roomPackage);
    const tiles = model.subroomsById["salon-trono"]?.layers[0]?.tiles;

    expect(tiles).toHaveLength(room.grid.cols * room.grid.rows);
    expect(tiles?.slice(0, 3)).toEqual([1, 1, 1]);
    expect(tiles?.[3]).toBe(0);
  });

  it("falla con un error claro si el RLE tiene longitud impar", () => {
    const invalid = loadValidPackage();
    const ground = invalid.map.rooms[0]?.layers[0];
    if (!ground) {
      throw new Error("el fixture no tiene la capa ground esperada");
    }
    ground.rle = [1];

    expect(() => toRuntimeModel(invalid)).toThrowError(/longitud impar/);
  });

  it("falla con un error claro si un objeto referencia una habitación inexistente", () => {
    const invalid = loadValidPackage();
    const object = invalid.objects[0];
    if (!object) {
      throw new Error("el fixture no tiene objetos");
    }
    object.roomId = "habitacion-fantasma";

    expect(() => toRuntimeModel(invalid)).toThrowError(/que no existe en map.rooms/);
  });

  it("falla con un error claro si un objeto cae fuera de la rejilla", () => {
    const invalid = loadValidPackage();
    const object = invalid.objects[0];
    if (!object) {
      throw new Error("el fixture no tiene objetos");
    }
    object.position = { x: 999, y: 0 };

    expect(() => toRuntimeModel(invalid)).toThrowError(/fuera de la rejilla/);
  });

  it("loadRuntimeModel encadena carga, validación y proyección", () => {
    const model = loadRuntimeModel(loadFixture());
    expect(model.meta.id).toBe("room-rey-aldric");
    expect(model.subrooms).toHaveLength(3);
  });

  it("F-27: deriva el nombre del objeto del diálogo de inspección cuando no tiene uno propio", () => {
    const model = toRuntimeModel(loadValidPackage());
    const cuadro = model.objectsById["cuadro-aurelio"];

    expect(cuadro?.name).toContain("Rey Aurelio");
  });

  it("F-27: prefiere el nombre propio del objeto sobre el del diálogo", () => {
    const roomPackage = loadValidPackage();
    const object = roomPackage.objects.find((candidate) => candidate.id === "cuadro-aurelio");
    if (!object) throw new Error("el fixture no tiene cuadro-aurelio");
    object.name = { es: { text: "Cuadro del rey" } };

    const model = toRuntimeModel(roomPackage);
    expect(model.objectsById["cuadro-aurelio"]?.name).toBe("Cuadro del rey");
  });

  it("F-27: sin nombre propio ni diálogo asociado, el objeto no expone `name`", () => {
    const model = toRuntimeModel(loadValidPackage());
    const sinDialogo = model.objects.find(
      (object) => !object.name && !object.inspectDialogId,
    );

    expect(sinDialogo).toBeDefined();
    expect(sinDialogo?.name).toBeUndefined();
  });
});
