import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRoomPackage, withLobbyRoom, lobbyRoomOf, type RoomPackage } from "../src/schemas";
import { validateRoomPackage } from "../src/validator";
import { makeRoom3D } from "./fixtures/room-3d";

/** Sala de espera por defecto en 3D (encargo 7.1a §4); en 2D no cambia. */

describe("withLobbyRoom en 3D", () => {
  const pkg = makeRoom3D();
  const withLobby = withLobbyRoom(pkg);
  const lobby = lobbyRoomOf(withLobby.map)!;
  const pieces = withLobby.world3d!.rooms[lobby.id]!.pieces;

  it("añade una habitación kind lobby de 8×8 sin capas ni decoraciones, al final", () => {
    expect(withLobby.map.rooms.at(-1)).toBe(lobby);
    expect(lobby).toMatchObject({
      id: "lobby",
      kind: "lobby",
      grid: { cols: 8, rows: 8 },
      layers: [],
      decorations: [],
    });
    expect(lobby.lighting).toEqual(pkg.map.rooms[0]!.lighting);
  });

  it("genera min(8, players.max) spawns en dos filas con h y yaw a 0", () => {
    const eight = withLobbyRoom({ ...pkg, meta: { ...pkg.meta, players: { min: 1, max: 8 } } });
    const spawns = lobbyRoomOf(eight.map)!.spawnPoints;
    expect(spawns).toHaveLength(8);
    expect(spawns.map((s) => [s.x, s.y])).toEqual([
      [2.5, 3.5],
      [3.5, 3.5],
      [4.5, 3.5],
      [5.5, 3.5],
      [2.5, 4.5],
      [3.5, 4.5],
      [4.5, 4.5],
      [5.5, 4.5],
    ]);
    expect(spawns.every((s) => s.h === 0 && s.yaw === 0)).toBe(true);
    expect(lobby.spawnPoints).toHaveLength(1);
  });

  it("genera 36 suelos interiores y 28 muros perimetrales, con ids deterministas", () => {
    const floors = pieces.filter((p) => p.model === "suelo-piedra-1");
    const walls = pieces.filter((p) => p.model === "muro");
    expect(floors).toHaveLength(36);
    expect(walls).toHaveLength(28);
    for (const f of floors) {
      expect(f.x).toBeGreaterThan(1);
      expect(f.x).toBeLessThan(7);
      expect(f.y).toBeGreaterThan(1);
      expect(f.y).toBeLessThan(7);
      expect(f.h).toBe(0);
    }
    expect(floors[0]).toMatchObject({ x: 1.5, y: 1.5 });
    expect(new Set(pieces.map((p) => p.id)).size).toBe(64);
    expect(pieces[0]!.id).toBe("p-00000000");
    expect(pieces[35]!.id).toBe("p-0000000z");
    expect(pieces[63]!.id).toBe("p-0000001r");
    expect(withLobbyRoom(pkg).world3d).toEqual(withLobby.world3d);
  });

  it("conserva el resto de world3d y el paquete original", () => {
    expect(withLobby.world3d!.models).toEqual(pkg.world3d!.models);
    expect(withLobby.world3d!.rooms["sala"]).toEqual(pkg.world3d!.rooms["sala"]);
    expect(pkg.map.rooms).toHaveLength(1);
    expect(Object.keys(pkg.world3d!.rooms)).toEqual(["sala"]);
  });

  it("el lobby generado no rompe la validación del paquete resultante", () => {
    const report = validateRoomPackage(withLobby);
    expect(report.checks.find((c) => c.id === "world3d")!.issues).toEqual([]);
  });

  it("no toca un paquete 3D que ya tiene lobby diseñado", () => {
    const own: RoomPackage = structuredClone(pkg);
    own.map.rooms.push({
      id: "vestibulo",
      name: "Vestíbulo",
      kind: "lobby",
      grid: { cols: 4, rows: 4 },
      layers: [],
      decorations: [],
      spawnPoints: [],
      lighting: [],
    });
    expect(withLobbyRoom(own)).toBe(own);
  });
});

describe("withLobbyRoom en 2D no cambia", () => {
  const fixturePath = fileURLToPath(
    new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
  );
  const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

  it("el lobby generado del Rey Aldric sigue siendo el de capas de tiles 10×8", () => {
    const result = withLobbyRoom(reyAldric);
    const lobby = lobbyRoomOf(result.map)!;
    expect(result.world3d).toBeUndefined();
    expect(lobby.grid).toEqual({ cols: 10, rows: 8 });
    expect(lobby.layers.length).toBeGreaterThan(0);
    expect(lobby.spawnPoints).toHaveLength(8);
    expect(lobby.spawnPoints.every((s) => s.h === undefined && s.yaw === undefined)).toBe(true);
    expect(lobby).toMatchSnapshot();
  });
});
