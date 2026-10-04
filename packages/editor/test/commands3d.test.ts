import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  RoomDocError,
  addLobbyRoom,
  defineSubRooms,
  fillPieces3D,
  listPieces3D,
  newPieceId,
  placeObject3D,
  placePieces3D,
  readObject,
  removePieces3D,
  roomDocToPackage,
  roomPackageToDoc,
  setObjectTransform,
  setRoomBounds3D,
  setSpawnPoints3D,
  updatePiece3D,
  renameObject,
  addObject,
  setSubRoomGrid,
} from "../src";
import { makeRoom3D } from "./fixtures/room-3d";

function doc3d(): Y.Doc {
  return roomPackageToDoc(makeRoom3D());
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof RoomDocError ? error.code : `otro: ${String(error)}`;
  }
  return undefined;
}

const floor = { model: "suelo-test", x: 1, y: 1, h: 0, yaw: 0 };

describe("newPieceId", () => {
  it("genera ids con el formato p-xxxxxxxx", () => {
    expect(newPieceId(doc3d())).toMatch(/^p-[a-z0-9]{8}$/);
  });
});

describe("placePieces3D / listPieces3D / updatePiece3D / removePieces3D", () => {
  it("coloca piezas, las lista en orden y devuelve ids", () => {
    const doc = doc3d();
    const ids = placePieces3D(doc, "sala", [floor, { ...floor, x: 2, scale: 2 }]);
    expect(ids).toHaveLength(2);
    const listed = listPieces3D(doc, "sala");
    expect(listed.slice(-2).map((p) => p.id)).toEqual(ids);
    expect(listed.at(-1)).toMatchObject({ x: 2, scale: 2, roomId: "sala" });
    expect(listPieces3D(doc, "otra")).toEqual([]);
    expect(roomDocToPackage(doc).world3d?.rooms.sala?.pieces).toHaveLength(6);
  });

  it("valida habitación, posición, yaw, escala e ids", () => {
    const doc = doc3d();
    expect(codeOf(() => placePieces3D(doc, "no", [floor]))).toBe("UNKNOWN_ROOM");
    expect(codeOf(() => placePieces3D(doc, "sala", [{ ...floor, x: 4.1 }]))).toBe("OUT_OF_BOUNDS");
    expect(codeOf(() => placePieces3D(doc, "sala", [{ ...floor, y: -1 }]))).toBe("OUT_OF_BOUNDS");
    expect(codeOf(() => placePieces3D(doc, "sala", [{ ...floor, h: 33 }]))).toBe("OUT_OF_BOUNDS");
    expect(codeOf(() => placePieces3D(doc, "sala", [{ ...floor, yaw: 360 }]))).toBe("INVALID_VALUE");
    expect(codeOf(() => placePieces3D(doc, "sala", [{ ...floor, yaw: -1 }]))).toBe("INVALID_VALUE");
    expect(codeOf(() => placePieces3D(doc, "sala", [{ ...floor, scale: 0.05 }]))).toBe("INVALID_VALUE");
    expect(codeOf(() => placePieces3D(doc, "sala", [{ ...floor, scale: 11 }]))).toBe("INVALID_VALUE");
    expect(codeOf(() => placePieces3D(doc, "sala", [{ ...floor, model: "Mal Id" }]))).toBe("INVALID_ID");
  });

  it("admite los bordes de la habitación y no escribe nada si una pieza falla", () => {
    const doc = doc3d();
    const before = listPieces3D(doc).length;
    placePieces3D(doc, "sala", [{ ...floor, x: 0, y: 4, h: 32 }]);
    expect(listPieces3D(doc)).toHaveLength(before + 1);
    expect(codeOf(() => placePieces3D(doc, "sala", [floor, { ...floor, x: 9 }]))).toBe("OUT_OF_BOUNDS");
    expect(listPieces3D(doc)).toHaveLength(before + 1);
  });

  it("actualiza una pieza y rechaza la desconocida o un parche inválido", () => {
    const doc = doc3d();
    const [id] = placePieces3D(doc, "sala", [{ ...floor, scale: 2 }]);
    updatePiece3D(doc, id!, { x: 3, yaw: 90, model: "muro", scale: undefined });
    const piece = listPieces3D(doc).find((p) => p.id === id)!;
    expect(piece).toMatchObject({ x: 3, yaw: 90, model: "muro", roomId: "sala" });
    expect(piece).not.toHaveProperty("scale");
    expect(codeOf(() => updatePiece3D(doc, "p-noexiste", { x: 1 }))).toBe("UNKNOWN_PIECE");
    expect(codeOf(() => updatePiece3D(doc, id!, { x: 99 }))).toBe("OUT_OF_BOUNDS");
    expect(codeOf(() => updatePiece3D(doc, id!, { yaw: 400 }))).toBe("INVALID_VALUE");
    expect(codeOf(() => updatePiece3D(doc, id!, { model: "X" }))).toBe("INVALID_ID");
  });

  it("borra piezas y cuenta solo las que existían", () => {
    const doc = doc3d();
    const ids = placePieces3D(doc, "sala", [floor, floor]);
    expect(removePieces3D(doc, [ids[0]!, "p-noexiste", ids[0]!])).toBe(1);
    expect(listPieces3D(doc).some((p) => p.id === ids[0])).toBe(false);
    expect(listPieces3D(doc).some((p) => p.id === ids[1])).toBe(true);
  });
});

describe("fillPieces3D", () => {
  it("de (0,0) a (2,1) crea 6 piezas en los centros de celda", () => {
    const doc = roomPackageToDoc({ ...makeRoom3D(), world3d: { rooms: { sala: { pieces: [] } }, models: {} } });
    const ids = fillPieces3D(doc, "sala", {
      model: "suelo-test",
      from: { x: 0, y: 0 },
      to: { x: 2, y: 1 },
      h: 0,
    });
    expect(ids).toHaveLength(6);
    expect(listPieces3D(doc, "sala").map((p) => [p.x, p.y, p.h, p.yaw])).toEqual([
      [0.5, 0.5, 0, 0],
      [1.5, 0.5, 0, 0],
      [2.5, 0.5, 0, 0],
      [0.5, 1.5, 0, 0],
      [1.5, 1.5, 0, 0],
      [2.5, 1.5, 0, 0],
    ]);
  });

  it("acepta esquinas en cualquier orden, aplica yaw y valida", () => {
    const doc = doc3d();
    const before = listPieces3D(doc).length;
    fillPieces3D(doc, "sala", { model: "m", from: { x: 1, y: 0 }, to: { x: 0, y: 0 }, h: 1, yaw: 90 });
    expect(listPieces3D(doc).slice(before).map((p) => [p.x, p.yaw, p.h])).toEqual([
      [0.5, 90, 1],
      [1.5, 90, 1],
    ]);
    const args = { model: "m", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, h: 0 };
    expect(codeOf(() => fillPieces3D(doc, "no", args))).toBe("UNKNOWN_ROOM");
    expect(codeOf(() => fillPieces3D(doc, "sala", { ...args, to: { x: 4, y: 1 } }))).toBe("OUT_OF_BOUNDS");
    expect(codeOf(() => fillPieces3D(doc, "sala", { ...args, from: { x: 0.5, y: 0 } }))).toBe("INVALID_VALUE");
    expect(codeOf(() => fillPieces3D(doc, "sala", { ...args, yaw: 360 }))).toBe("INVALID_VALUE");
    expect(codeOf(() => fillPieces3D(doc, "sala", { ...args, model: "X" }))).toBe("INVALID_ID");
  });

  it("respeta el tope de piezas por habitación sin escribir nada", () => {
    const doc = doc3d();
    setRoomBounds3D(doc, "sala", { cols: 64, rows: 64 });
    const before = listPieces3D(doc).length;
    // 64×64 = 4096 > 4000
    const fill = { model: "m", from: { x: 0, y: 0 }, to: { x: 63, y: 63 }, h: 0 };
    expect(codeOf(() => fillPieces3D(doc, "sala", fill))).toBe("INVALID_VALUE");
    expect(listPieces3D(doc)).toHaveLength(before);
    // El tope también vale para placePieces3D (suma a lo existente).
    fillPieces3D(doc, "sala", { ...fill, to: { x: 63, y: 61 } }); // 3968
    expect(codeOf(() => placePieces3D(doc, "sala", Array.from({ length: 40 }, () => floor)))).toBe(
      "INVALID_VALUE",
    );
  });

  it("no borra ni deduplica lo que ya hay en las celdas", () => {
    const doc = doc3d();
    const before = listPieces3D(doc).length;
    const args = { model: "m", from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, h: 0 };
    fillPieces3D(doc, "sala", args);
    fillPieces3D(doc, "sala", args);
    expect(listPieces3D(doc)).toHaveLength(before + 2);
  });
});

describe("objetos 3D", () => {
  it("placeObject3D deriva position del transform", () => {
    const doc = doc3d();
    const id = placeObject3D(doc, {
      roomId: "sala",
      sprite: "cofre",
      transform: { x: 1.4, y: 3.6, h: 0.5, yaw: 45, scale: 2 },
    });
    expect(id).toBe("cofre-sala");
    expect(readObject(doc, id)).toMatchObject({
      position: { x: 1, y: 4 },
      transform: { x: 1.4, y: 3.6, h: 0.5, yaw: 45, scale: 2 },
      type: "decorativo",
      interactable: true,
    });
  });

  it("placeObject3D valida", () => {
    const doc = doc3d();
    const base = { roomId: "sala", sprite: "cofre", transform: { x: 1, y: 1, h: 0, yaw: 0 } };
    expect(codeOf(() => placeObject3D(doc, { ...base, roomId: "no" }))).toBe("UNKNOWN_ROOM");
    expect(codeOf(() => placeObject3D(doc, { ...base, transform: { ...base.transform, x: 5 } }))).toBe("OUT_OF_BOUNDS");
    expect(codeOf(() => placeObject3D(doc, { ...base, transform: { ...base.transform, yaw: 360 } }))).toBe("INVALID_VALUE");
    expect(codeOf(() => placeObject3D(doc, { ...base, transform: { ...base.transform, scale: 20 } }))).toBe("INVALID_VALUE");
    expect(codeOf(() => placeObject3D(doc, { ...base, sprite: "Mal" }))).toBe("INVALID_ID");
    expect(codeOf(() => placeObject3D(doc, { ...base, id: "arca" }))).toBe("DUPLICATE_ID");
  });

  it("setObjectTransform actualiza transform y position", () => {
    const doc = doc3d();
    setObjectTransform(doc, "arca", { x: 0.2, y: 3.9, h: 1, yaw: 270 });
    expect(readObject(doc, "arca")).toMatchObject({
      position: { x: 0, y: 4 },
      transform: { x: 0.2, y: 3.9, h: 1, yaw: 270 },
    });
    expect(codeOf(() => setObjectTransform(doc, "no", { x: 1, y: 1, h: 0, yaw: 0 }))).toBe("UNKNOWN_OBJECT");
    expect(codeOf(() => setObjectTransform(doc, "arca", { x: 1, y: 1, h: 0, yaw: 0 }, "no"))).toBe("UNKNOWN_ROOM");
    expect(codeOf(() => setObjectTransform(doc, "arca", { x: 1, y: 9, h: 0, yaw: 0 }))).toBe("OUT_OF_BOUNDS");
    expect(codeOf(() => setObjectTransform(doc, "arca", { x: 1, y: 1, h: 0, yaw: 361 }))).toBe("INVALID_VALUE");
  });

  it("setObjectTransform puede pasar el objeto a otra habitación", () => {
    const doc = doc3d();
    defineSubRooms(doc, [{ id: "otra", name: "Otra", grid: { cols: 2, rows: 2 } }]);
    setObjectTransform(doc, "arca", { x: 1.5, y: 1.5, h: 0, yaw: 0 }, "otra");
    expect(readObject(doc, "arca")?.roomId).toBe("otra");
    expect(codeOf(() => setObjectTransform(doc, "arca", { x: 3, y: 1, h: 0, yaw: 0 }, "otra"))).toBe("OUT_OF_BOUNDS");
  });

  it("addObject en 3D exige transform y sobrescribe position", () => {
    const doc = doc3d();
    const arca = readObject(doc, "arca")!;
    const sinTransform: Partial<typeof arca> = { ...arca };
    delete sinTransform.transform;
    expect(codeOf(() => addObject(doc, { ...(sinTransform as typeof arca), id: "otra-arca" }))).toBe("INVALID_VALUE");
    addObject(doc, {
      ...arca,
      id: "otra-arca",
      position: { x: 0, y: 0 },
      transform: { x: 3.4, y: 0.6, h: 0, yaw: 0 },
    });
    expect(readObject(doc, "otra-arca")?.position).toEqual({ x: 3, y: 1 });
    expect(
      codeOf(() => addObject(doc, { ...arca, id: "fuera", transform: { x: 4.5, y: 1, h: 0, yaw: 0 } })),
    ).toBe("OUT_OF_BOUNDS");
  });
});

describe("spawns y habitaciones 3D", () => {
  it("setSpawnPoints3D sustituye los spawns y valida", () => {
    const doc = doc3d();
    setSpawnPoints3D(doc, "sala", [
      { id: "spawn-1", x: 0.5, y: 0.5, h: 0, yaw: 0 },
      { id: "spawn-2", x: 4, y: 4, h: 2, yaw: 359 },
    ]);
    expect(roomDocToPackage(doc).map.rooms[0]?.spawnPoints).toEqual([
      { id: "spawn-1", x: 0.5, y: 0.5, h: 0, yaw: 0 },
      { id: "spawn-2", x: 4, y: 4, h: 2, yaw: 359 },
    ]);
    const spawn = { id: "s", x: 1, y: 1, h: 0, yaw: 0 };
    expect(codeOf(() => setSpawnPoints3D(doc, "no", [spawn]))).toBe("UNKNOWN_ROOM");
    expect(codeOf(() => setSpawnPoints3D(doc, "sala", [{ ...spawn, x: 4.5 }]))).toBe("OUT_OF_BOUNDS");
    expect(codeOf(() => setSpawnPoints3D(doc, "sala", [{ ...spawn, yaw: 360 }]))).toBe("INVALID_VALUE");
  });

  it("defineSubRooms crea la habitación 3D sin capas y con spawn por defecto", () => {
    const doc = doc3d();
    defineSubRooms(doc, [{ id: "nueva", name: "Nueva", grid: { cols: 5, rows: 7 } }]);
    const room = roomDocToPackage(doc).map.rooms.find((r) => r.id === "nueva")!;
    expect(room.layers).toEqual([]);
    // La primera habitación de juego ya tiene spawn: la nueva no recibe ninguno.
    expect(room.spawnPoints).toEqual([]);
    const solo = roomPackageToDoc({ ...makeRoom3D(), map: { tileset: "medieval-v1", rooms: [] }, objects: [], rules: [], world3d: { rooms: {}, models: {} } });
    defineSubRooms(solo, [{ id: "a", name: "A", grid: { cols: 5, rows: 7 } }]);
    expect(roomDocToPackage(solo).map.rooms[0]?.spawnPoints).toEqual([
      { id: "spawn-1", x: 2.5, y: 3.5, h: 0, yaw: 0 },
    ]);
  });

  it("setRoomBounds3D redimensiona; al encoger comprueba las piezas", () => {
    const doc = doc3d();
    setRoomBounds3D(doc, "sala", { cols: 6, rows: 5 });
    expect(roomDocToPackage(doc).map.rooms[0]?.grid).toEqual({ cols: 6, rows: 5 });
    placePieces3D(doc, "sala", [{ ...floor, x: 5.5 }, { ...floor, x: 6 }]);
    let message = "";
    try {
      setRoomBounds3D(doc, "sala", { cols: 3, rows: 5 });
    } catch (error) {
      message = (error as RoomDocError).code + (error as Error).message;
    }
    expect(message).toContain("OUT_OF_BOUNDS");
    expect(message).toContain("2 piezas");
    expect(roomDocToPackage(doc).map.rooms[0]?.grid).toEqual({ cols: 6, rows: 5 });
    // setSubRoomGrid sin capas también vale en 3D.
    setSubRoomGrid(doc, "sala", { cols: 7, rows: 5 });
  });

  it("addLobbyRoom en 3D crea la sala sin capas y sus piezas (suelo y muro)", () => {
    const doc = doc3d();
    const id = addLobbyRoom(doc, { cols: 6, rows: 5 });
    const pkg = roomDocToPackage(doc);
    const room = pkg.map.rooms.find((r) => r.id === id)!;
    expect(room).toMatchObject({ kind: "lobby", layers: [], grid: { cols: 6, rows: 5 } });
    expect(room.spawnPoints.length).toBeGreaterThan(0);
    for (const s of room.spawnPoints) {
      expect(s.x).toBeGreaterThanOrEqual(1);
      expect(s.x).toBeLessThanOrEqual(5);
      expect(s.y).toBeGreaterThanOrEqual(1);
      expect(s.y).toBeLessThanOrEqual(4);
    }
    const pieces = pkg.world3d!.rooms[id]!.pieces;
    expect(pieces).toHaveLength(30);
    expect(pieces.filter((p) => p.model === "suelo-piedra-1")).toHaveLength(12);
    expect(pieces.filter((p) => p.model === "muro")).toHaveLength(18);
    expect(new Set(pieces.map((p) => p.id)).size).toBe(30);
    expect(pieces.every((p) => /^p-[a-z0-9]{8}$/.test(p.id))).toBe(true);
  });
});

describe("sincronización", () => {
  it("dos documentos que colocan piezas a la vez acaban con todas", () => {
    const a = doc3d();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const base = listPieces3D(a).length;
    const idsA = placePieces3D(a, "sala", [floor, { ...floor, x: 2 }]);
    const idsB = placePieces3D(b, "sala", [{ ...floor, x: 3 }]);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    for (const doc of [a, b]) {
      const ids = listPieces3D(doc).map((p) => p.id);
      expect(ids).toHaveLength(base + 3);
      expect(ids).toEqual(expect.arrayContaining([...idsA, ...idsB]));
    }
    expect(listPieces3D(a).map((p) => p.id)).toEqual(listPieces3D(b).map((p) => p.id));
  });
});

describe("renameObject y piezas", () => {
  it("renombrar un objeto cuyo id coincide con el model de una pieza funciona", () => {
    const doc = doc3d();
    placeObject3D(doc, {
      roomId: "sala",
      sprite: "cofre",
      id: "muro",
      transform: { x: 1, y: 1, h: 0, yaw: 0 },
    });
    placePieces3D(doc, "sala", [{ ...floor, model: "muro" }]);
    renameObject(doc, "muro", "muro-grande");
    expect(readObject(doc, "muro-grande")).toBeDefined();
    expect(readObject(doc, "muro")).toBeUndefined();
  });
});
