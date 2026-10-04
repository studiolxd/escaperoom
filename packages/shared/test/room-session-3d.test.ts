import { describe, expect, it } from "vitest";
import { parseRoomPackage, type RoomPackage } from "../src/schemas";
import { createRoomSession } from "../src/session";
import { makeRoom3D } from "./fixtures/room-3d";

/**
 * Mecánicas de posición con altura (encargo 7.1a §5, specs/27 §6.4): en una
 * sala 3D, placas y mirillas exigen además |h − transform.h| ≤ 1; en 2D la
 * altura no existe y nada cambia.
 */

function withPlate(pkg: RoomPackage, plateHeight: number): RoomPackage {
  const out = structuredClone(pkg);
  const is3d = out.meta.dimension === "3d";
  out.objects.push({
    id: "placa",
    roomId: "sala",
    type: "placa",
    position: { x: 2, y: 2 },
    ...(is3d ? { transform: { x: 2, y: 2, h: plateHeight, yaw: 0 } } : {}),
    sprite: "placa-test",
    states: { up: "placa-test", down: "placa-test" },
    initialState: "up",
    interactable: false,
  });
  out.puzzles.push({
    id: "p-placa",
    type: "simultaneous_plates",
    layer: "world",
    roomId: "sala",
    requiresSolved: [],
    grantsItems: [],
    unlocks: [],
    plates: [{ objectId: "placa", x: 2, y: 2 }],
    windowMs: 800,
    holdMode: "stand",
  } as unknown as RoomPackage["puzzles"][number]);
  return parseRoomPackage(out);
}

function room2D(): RoomPackage {
  const pkg = makeRoom3D();
  delete pkg.world3d;
  delete pkg.meta.dimension;
  delete pkg.objects[0]!.transform;
  delete pkg.map.rooms[0]!.spawnPoints[0]!.h;
  delete pkg.map.rooms[0]!.spawnPoints[0]!.yaw;
  return pkg;
}

describe("RoomSession — posición con altura", () => {
  it("spawnPlayer copia h y yaw del spawnPoint; movePlayer guarda h y yaw", () => {
    const session = createRoomSession(makeRoom3D(), { playerIds: ["a"] });
    session.spawnPlayer("a");
    expect(session.playerPosition("a")).toMatchObject({
      roomId: "sala",
      x: 1.5,
      y: 1.5,
      h: 0,
      yaw: 90,
    });
    session.movePlayer("a", "sala", 2, 2, undefined, { h: 0.4, yaw: 45 });
    expect(session.playerPosition("a")).toEqual({ roomId: "sala", x: 2, y: 2, h: 0.4, yaw: 45 });
  });

  it("las llamadas existentes de movePlayer no añaden h ni yaw", () => {
    const session = createRoomSession(room2D(), { playerIds: ["a"] });
    session.movePlayer("a", "sala", 2, 2);
    expect(session.playerPosition("a")).toEqual({ roomId: "sala", x: 2, y: 2 });
  });

  it("renamePlayer conserva h y yaw", () => {
    const session = createRoomSession(makeRoom3D(), { playerIds: ["a"] });
    session.movePlayer("a", "sala", 2, 2, undefined, { h: 1.2, yaw: 10 });
    session.renamePlayer("a", "b");
    expect(session.playerPosition("b")).toEqual({ roomId: "sala", x: 2, y: 2, h: 1.2, yaw: 10 });
    expect(session.playerPosition("a")).toBeUndefined();
  });
});

describe("RoomSession — placas con altura", () => {
  it("en 3D, encima en planta pero 2 m más arriba NO activa la placa", () => {
    const session = createRoomSession(withPlate(makeRoom3D(), 0), { playerIds: ["a"] });
    session.movePlayer("a", "sala", 2, 2, undefined, { h: 2 });
    expect(session.isPuzzleSolved("p-placa")).toBe(false);
  });

  it("en 3D, a la misma altura (≤ 1 m) sí la activa", () => {
    const session = createRoomSession(withPlate(makeRoom3D(), 0), { playerIds: ["a"] });
    session.movePlayer("a", "sala", 2, 2, undefined, { h: 1 });
    expect(session.isPuzzleSolved("p-placa")).toBe(true);
  });

  it("en 3D, sin h el jugador cuenta como h = 0; la placa lleva su transform.h", () => {
    const high = createRoomSession(withPlate(makeRoom3D(), 3), { playerIds: ["a"] });
    high.movePlayer("a", "sala", 2, 2);
    expect(high.isPuzzleSolved("p-placa")).toBe(false);
    high.movePlayer("a", "sala", 2, 2, undefined, { h: 3 });
    expect(high.isPuzzleSolved("p-placa")).toBe(true);
  });

  it("en 2D la altura no existe: el comportamiento no cambia", () => {
    const session = createRoomSession(withPlate(room2D(), 0), { playerIds: ["a"] });
    session.movePlayer("a", "sala", 2, 2, undefined, { h: 2 });
    expect(session.isPuzzleSolved("p-placa")).toBe(true);
  });
});

function withViewpoint(pkg: RoomPackage, viewpointHeight: number): RoomPackage {
  const out = structuredClone(pkg);
  const is3d = out.meta.dimension === "3d";
  for (const [id, x] of [
    ["mirilla-a", 1],
    ["mirilla-b", 3],
  ] as const) {
    out.objects.push({
      id,
      roomId: "sala",
      type: "mirilla",
      position: { x, y: 2 },
      ...(is3d ? { transform: { x, y: 2, h: viewpointHeight, yaw: 0 } } : {}),
      sprite: "mirilla-test",
      states: { idle: "mirilla-test" },
      initialState: "idle",
      interactable: false,
    });
  }
  out.puzzles.push({
    id: "p-mirillas",
    type: "split_clue",
    layer: "world",
    roomId: "sala",
    requiresSolved: [],
    grantsItems: [],
    unlocks: [],
    viewpoints: [
      { objectId: "mirilla-a", zone: { x: 0, y: 1, w: 2, h: 2 } },
      { objectId: "mirilla-b", zone: { x: 2, y: 1, w: 2, h: 2 } },
    ],
    fragments: ["luna", "corona"],
    visibleByViewpoint: { "mirilla-a": ["luna", null], "mirilla-b": [null, "corona"] },
    wallOccluder: { x: 2, y: 1, w: 0, h: 2 },
    inputUI: "symbols",
  } as unknown as RoomPackage["puzzles"][number]);
  return parseRoomPackage(out);
}

describe("RoomSession — mirillas con altura", () => {
  it("en 3D, dentro de la zona pero 2 m más arriba NO ocupa la mirilla", () => {
    const session = createRoomSession(withViewpoint(makeRoom3D(), 0), { playerIds: ["a"] });
    session.movePlayer("a", "sala", 1, 2, undefined, { h: 2 });
    expect(session.viewpointOf("p-mirillas", "a")).toBeNull();
    session.movePlayer("a", "sala", 1, 2, undefined, { h: 0.5 });
    expect(session.viewpointOf("p-mirillas", "a")).toBe("mirilla-a");
  });

  it("en 3D la celda `i` va de `i` a `i + 1`: (9.2, 10.7) está en la zona {9, 10, 2, 2} y (11.1, 10.5) no", () => {
    const pkg = withViewpoint(makeRoom3D(), 0);
    const puzzle = pkg.puzzles.find((p) => p.id === "p-mirillas");
    if (puzzle?.type !== "split_clue") throw new Error("falta el split_clue");
    puzzle.viewpoints[0]!.zone = { x: 9, y: 10, w: 2, h: 2 };
    const session = createRoomSession(pkg, { playerIds: ["a"] });
    session.movePlayer("a", "sala", 9.2, 10.7, undefined, { h: 0 });
    expect(session.viewpointOf("p-mirillas", "a")).toBe("mirilla-a");
    session.movePlayer("a", "sala", 11.1, 10.5, undefined, { h: 0 });
    expect(session.viewpointOf("p-mirillas", "a")).toBeNull();
  });

  it("en 2D la altura no existe: el comportamiento no cambia", () => {
    const session = createRoomSession(withViewpoint(room2D(), 0), { playerIds: ["a"] });
    session.movePlayer("a", "sala", 1, 2, undefined, { h: 2 });
    expect(session.viewpointOf("p-mirillas", "a")).toBe("mirilla-a");
  });
});
