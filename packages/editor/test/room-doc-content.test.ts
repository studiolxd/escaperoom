import { RoomPackageSchema } from "@escaperoom/shared/schemas";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  RoomDocError,
  addDialog,
  addHint,
  addObject,
  addPuzzle,
  defineItem,
  defineSubRooms,
  initRoomDoc,
  paintTiles,
  proposeHintId,
  roomDocToPackage,
  setSubRoomGrid,
  setTileset,
  writeRoomMeta,
} from "../src";

/** Sala vacía con metadata (lo que deja `create_room` del MCP). */
function emptyRoom(): Y.Doc {
  const doc = new Y.Doc();
  writeRoomMeta(doc, {
    id: "sala",
    title: "Sala",
    authorId: "autora",
    theme: "medieval",
    languages: ["es", "en"],
    defaultLanguage: "es",
  });
  return doc;
}

function codeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error instanceof RoomDocError ? error.code : error;
  }
  return undefined;
}

const puzzle = {
  id: "p-arca",
  type: "code_lock" as const,
  layer: "panel" as const,
  roomId: "salon",
  requiresSolved: [],
  grantsItems: [],
  unlocks: [],
  length: 3,
  code: "123",
};

describe("comandos de estructura y contenido (4.2)", () => {
  it("writeRoomMeta comparte valores por defecto con initRoomDoc", () => {
    const fromInit = new Y.Doc();
    initRoomDoc(fromInit, { id: "sala", title: "Sala", authorId: "autora", language: "es" });
    const fromMeta = new Y.Doc();
    writeRoomMeta(fromMeta, {
      id: "sala",
      title: "Sala",
      authorId: "autora",
      theme: "medieval",
      languages: ["es"],
      defaultLanguage: "es",
    });
    expect(roomDocToPackage(fromMeta).meta).toEqual(roomDocToPackage(fromInit).meta);
  });

  it("define habitaciones (con spawn por defecto solo en la primera) y las redimensiona", () => {
    const doc = emptyRoom();
    expect(
      defineSubRooms(doc, [
        { id: "salon", name: "Salón", grid: { cols: 6, rows: 4 } },
        { id: "bodega", name: "Bodega", grid: { cols: 3, rows: 3 } },
      ]),
    ).toEqual({ created: ["salon", "bodega"], updated: [] });
    paintTiles(
      doc,
      "salon",
      "ground",
      [
        { x: 5, y: 3 },
        { x: 0, y: 0 },
      ],
      4,
    );

    // Encoger sin reubicar el spawn (auditoría D-3): «spawn-1» (3,2) quedaría
    // fuera de una rejilla de 3×2 (x/y válidos hasta 2). Se impide.
    expect(
      codeOf(() =>
        defineSubRooms(doc, [{ id: "salon", name: "Gran salón", grid: { cols: 3, rows: 2 } }]),
      ),
    ).toBe("OUT_OF_BOUNDS");

    expect(
      defineSubRooms(doc, [
        {
          id: "salon",
          name: "Gran salón",
          grid: { cols: 3, rows: 2 },
          spawnPoints: [{ id: "spawn-1", x: 1, y: 1 }],
        },
      ]),
    ).toEqual({ created: [], updated: ["salon"] });
    const [salon, bodega] = roomDocToPackage(doc).map.rooms;
    expect(salon).toMatchObject({ name: "Gran salón", grid: { cols: 3, rows: 2 } });
    expect(salon?.spawnPoints).toEqual([{ id: "spawn-1", x: 1, y: 1 }]);
    // La celda (5, 3) quedó fuera al encoger: se borra del doc.
    expect(salon?.layers).toEqual([{ name: "ground", rle: [1, 4, 2, 0, 3, 0] }]);
    expect(bodega?.spawnPoints).toEqual([]);
    expect(
      codeOf(() => defineSubRooms(doc, [{ id: "Mal id", name: "", grid: { cols: 1, rows: 1 } }])),
    ).toBe("INVALID_ID");
  });

  it("setSubRoomGrid sustituye las capas desde RLE y setTileset cambia el pack", () => {
    const doc = emptyRoom();
    defineSubRooms(doc, [{ id: "salon", name: "Salón", grid: { cols: 2, rows: 2 } }]);
    setSubRoomGrid(doc, "salon", { cols: 3, rows: 2 }, [
      { name: "ground", rle: [6, 1] },
      { name: "walls", rle: [3, 2, 3, 0] },
    ]);
    setTileset(doc, "cripta-v1");
    const pkg = roomDocToPackage(doc);
    expect(pkg.map.tileset).toBe("cripta-v1");
    expect(pkg.meta.assetsManifest).toBe("r2://assets/packs/cripta-v1/manifest.json");
    expect(pkg.map.rooms[0]?.layers).toEqual([
      { name: "ground", rle: [3, 1, 3, 1] },
      { name: "walls", rle: [3, 2, 3, 0] },
    ]);
    expect(
      codeOf(() => setSubRoomGrid(doc, "salon", { cols: 1, rows: 1 }, [{ name: "g", rle: [1] }])),
    ).toBe("OUT_OF_BOUNDS");
  });

  // Regresión D-1 (auditoría 2026-09-24): un `define_subrooms`/`set_map` con
  // una rejilla descomunal asignaba un `Y.Map` de tiles y arrays proporcionales
  // a `cols*rows` antes de que ningún esquema Zod llegara a rechazarlo
  // (`mutateDraft` solo valida en dry-run DESPUÉS de ejecutar la operación).
  it("setSubRoomGrid y defineSubRooms rechazan rejillas descomunales sin llegar a asignarlas", () => {
    const doc = emptyRoom();
    defineSubRooms(doc, [{ id: "salon", name: "Salón", grid: { cols: 2, rows: 2 } }]);
    expect(codeOf(() => setSubRoomGrid(doc, "salon", { cols: 3000, rows: 3000 }))).toBe(
      "OUT_OF_BOUNDS",
    );
    expect(
      codeOf(() =>
        defineSubRooms(doc, [{ id: "otra", name: "Otra", grid: { cols: 100_000, rows: 100_000 } }]),
      ),
    ).toBe("OUT_OF_BOUNDS");
    // La existente conserva su rejilla original: la operación falló entera.
    expect(roomDocToPackage(doc).map.rooms[0]?.grid).toEqual({ cols: 2, rows: 2 });
  });

  it("da de alta contenido válido por esquema y comprueba referencias e idiomas", () => {
    const doc = emptyRoom();
    defineSubRooms(doc, [{ id: "salon", name: "Salón", grid: { cols: 4, rows: 4 } }]);
    defineItem(doc, { id: "llave", name: { es: { text: "Llave" } }, icon: "icon-llave" });
    addObject(doc, {
      id: "arca",
      roomId: "salon",
      type: "cofre",
      position: { x: 1, y: 1 },
      sprite: "arca",
      states: {},
      initialState: "",
      interactable: true,
    });
    addPuzzle(doc, puzzle);
    addDialog(doc, { id: "d-intro", text: { es: { text: "Hola" }, en: { text: "Hi" } } });
    expect(proposeHintId(doc, "p-arca", 1)).toBe("hint-arca-1");
    addHint(doc, {
      id: "hint-arca-1",
      puzzleId: "p-arca",
      tier: 1,
      cost: 1,
      text: { es: { text: "…" } },
    });
    expect(proposeHintId(doc, "p-arca", 1)).toBe("hint-arca-1-2");

    expect(RoomPackageSchema.safeParse(roomDocToPackage(doc)).success).toBe(true);

    expect(codeOf(() => addPuzzle(doc, { ...puzzle, id: "p-2", roomId: "nada" }))).toBe(
      "UNKNOWN_ROOM",
    );
    expect(codeOf(() => addPuzzle(doc, puzzle))).toBe("DUPLICATE_ID");
    expect(
      codeOf(() => defineItem(doc, { id: "arca", name: { es: { text: "x" } }, icon: "" })),
    ).toBe("DUPLICATE_ID");
    expect(codeOf(() => addDialog(doc, { id: "d-intro", text: { es: { text: "x" } } }))).toBe(
      "DUPLICATE_ID",
    );
    expect(codeOf(() => addDialog(doc, { id: "d-fr", text: { fr: { text: "x" } } }))).toBe(
      "UNKNOWN_LANGUAGE",
    );
    expect(codeOf(() => addDialog(doc, { id: "d-vacio", text: {} }))).toBe("UNKNOWN_LANGUAGE");
    expect(
      codeOf(() =>
        addHint(doc, { id: "h", puzzleId: "p-x", tier: 1, cost: 0, text: { es: { text: "x" } } }),
      ),
    ).toBe("UNKNOWN_PUZZLE");
    expect(
      codeOf(() =>
        addObject(doc, { ...roomDocToPackage(doc).objects[0]!, id: "b", position: { x: 9, y: 9 } }),
      ),
    ).toBe("OUT_OF_BOUNDS");
  });

  it("replace sustituye la entrada conservando su orden", () => {
    const doc = emptyRoom();
    addDialog(doc, { id: "d-1", text: { es: { text: "uno" } } });
    addDialog(doc, { id: "d-2", text: { es: { text: "dos" } } });
    expect(addDialog(doc, { id: "d-1", text: { en: { text: "one" } } }, { replace: true })).toEqual(
      {
        replaced: true,
      },
    );
    expect(roomDocToPackage(doc).dialogs).toEqual([
      { id: "d-1", text: { en: { text: "one" } } },
      { id: "d-2", text: { es: { text: "dos" } } },
    ]);
  });
});
