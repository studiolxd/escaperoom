import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRoomPackage } from "@escaperoom/shared/schemas";
import { describe, expect, it } from "vitest";
import {
  RoomDocError,
  addDecoration,
  addObject,
  assertDimension,
  eraseTiles,
  fillPieces3D,
  fillTiles,
  initRoomDoc,
  moveDecoration,
  moveObject,
  paintTiles,
  placeObject,
  placeObject3D,
  placePieces3D,
  readObject,
  removeDecoration,
  removePieces3D,
  roomDimension,
  roomPackageToDoc,
  setDecorationSprite,
  setDecorations,
  setObjectTransform,
  setRoomBounds3D,
  setSpawnPoints3D,
  setSubRoomGrid,
  setTileset,
  updatePiece3D,
  writeRoomMeta,
} from "../src";
import * as Y from "yjs";
import { makeRoom3D } from "./fixtures/room-3d";

const aldric = parseRoomPackage(
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
      ),
      "utf8",
    ),
  ) as unknown,
);

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof RoomDocError ? error.code : `otro: ${String(error)}`;
  }
  return undefined;
}

const cell = { x: 1, y: 1 };

describe("comandos 2D en una sala 3D", () => {
  const doc = () => roomPackageToDoc(makeRoom3D());

  it("lanzan WRONG_DIMENSION", () => {
    const d = doc();
    const room = "sala";
    const cases: Record<string, () => unknown> = {
      paintTiles: () => paintTiles(d, room, "ground", [cell], 1),
      eraseTiles: () => eraseTiles(d, room, "ground", [cell]),
      fillTiles: () => fillTiles(d, room, "ground", cell, 1),
      placeObject: () => placeObject(d, { roomId: room, sprite: "x", position: cell }),
      moveObject: () => moveObject(d, "arca", cell),
      addDecoration: () => addDecoration(d, room, { sprite: "x", x: 1, y: 1 }),
      moveDecoration: () => moveDecoration(d, room, 0, cell),
      setDecorationSprite: () => setDecorationSprite(d, room, 0, "y"),
      removeDecoration: () => removeDecoration(d, room, 0),
      setDecorations: () => setDecorations(d, room, []),
      setSubRoomGridConCapas: () =>
        setSubRoomGrid(d, room, { cols: 4, rows: 4 }, [{ name: "ground", rle: [16, 0] }]),
    };
    for (const [name, run] of Object.entries(cases)) {
      expect([name, code(run)]).toEqual([name, "WRONG_DIMENSION"]);
    }
  });

  it("setSubRoomGrid sin capas y setTileset valen en 3D", () => {
    const d = doc();
    expect(code(() => setSubRoomGrid(d, "sala", { cols: 5, rows: 5 }))).toBeUndefined();
    expect(code(() => setTileset(d, "medieval-v1"))).toBeUndefined();
  });

  it("addObject en 3D deriva position del transform", () => {
    const d = doc();
    addObject(d, {
      ...readObject(d, "arca")!,
      id: "arca-2",
      position: { x: 0, y: 0 },
      transform: { x: 2.6, y: 1.2, h: 0, yaw: 0 },
    });
    expect(readObject(d, "arca-2")?.position).toEqual({ x: 3, y: 1 });
  });
});

describe("comandos 3D en una sala 2D", () => {
  const doc = () => roomPackageToDoc(aldric);

  it("lanzan WRONG_DIMENSION", () => {
    const d = doc();
    const room = aldric.map.rooms[0]!.id;
    const t = { x: 1, y: 1, h: 0, yaw: 0 };
    const cases: Record<string, () => unknown> = {
      setRoomBounds3D: () => setRoomBounds3D(d, room, { cols: 5, rows: 5 }),
      placePieces3D: () => placePieces3D(d, room, []),
      updatePiece3D: () => updatePiece3D(d, "p-aaaaaaaa", {}),
      removePieces3D: () => removePieces3D(d, []),
      fillPieces3D: () =>
        fillPieces3D(d, room, { model: "m", from: cell, to: cell, h: 0 }),
      placeObject3D: () => placeObject3D(d, { roomId: room, sprite: "x", transform: t }),
      setObjectTransform: () => setObjectTransform(d, "x", t),
      setSpawnPoints3D: () => setSpawnPoints3D(d, room, []),
    };
    for (const [name, run] of Object.entries(cases)) {
      expect([name, code(run)]).toEqual([name, "WRONG_DIMENSION"]);
    }
  });
});

describe("dimensión del documento", () => {
  it("roomDimension: ausente = 2d", () => {
    expect(roomDimension(new Y.Doc())).toBe("2d");
    expect(roomDimension(roomPackageToDoc(aldric))).toBe("2d");
    expect(roomDimension(roomPackageToDoc(makeRoom3D()))).toBe("3d");
  });

  it("writeRoomMeta escribe la clave solo con '3d'", () => {
    const base = {
      id: "r",
      title: "R",
      authorId: "a",
      theme: "medieval",
      languages: ["es"],
      defaultLanguage: "es",
    };
    const d3 = new Y.Doc();
    writeRoomMeta(d3, { ...base, dimension: "3d" });
    expect(roomDimension(d3)).toBe("3d");
    for (const dimension of ["2d", undefined] as const) {
      const d = new Y.Doc();
      writeRoomMeta(d, { ...base, ...(dimension ? { dimension } : {}) });
      expect(d.getMap("meta").has("dimension")).toBe(false);
      expect(roomDimension(d)).toBe("2d");
    }
  });

  it("assertDimension cita el comando y la dimensión", () => {
    expect(() => assertDimension(new Y.Doc(), "3d", "foo")).toThrow("foo solo existe en salas 3d");
  });

  it("initRoomDoc sigue creando salas 2D", () => {
    const d = new Y.Doc();
    initRoomDoc(d, { id: "r", title: "R", language: "es" });
    expect(roomDimension(d)).toBe("2d");
  });
});
