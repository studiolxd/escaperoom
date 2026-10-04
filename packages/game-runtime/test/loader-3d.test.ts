import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RoomPackageLoadError,
  loadRoomPackage,
  toPublicRuntimeModel,
  toRuntimeModel,
  type RoomPackage,
} from "../src/loader";
import { makeRoom3D } from "./fixtures/room-3d";

const aldric = loadRoomPackage(
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
      ),
      "utf8",
    ),
  ) as unknown,
);

function with3D(edit: (pkg: RoomPackage) => void): RoomPackage {
  const pkg = makeRoom3D();
  edit(pkg);
  return pkg;
}

describe("loader 3D", () => {
  it("el modelo de una sala 3D lleva dimension, pieces, transform, h y yaw", () => {
    const model = toRuntimeModel(makeRoom3D());
    expect(model.dimension).toBe("3d");
    const room = model.subroomsById.sala!;
    expect(room.width).toBe(4);
    expect(room.height).toBe(4);
    expect(room.layers).toEqual([]);
    expect(room.decorations).toEqual([]);
    expect(room.pieces).toHaveLength(4);
    expect(room.pieces[0]).toMatchObject({ id: "p-suelo000", model: "suelo-test" });
    expect(room.spawns[0]).toMatchObject({ x: 1.5, y: 1.5, h: 0, yaw: 90, playerIndex: 1 });
    expect(model.objectsById.arca?.transform).toEqual({ x: 2.6, y: 2.2, h: 0, yaw: 180 });
    expect(model.customModels["arca-test"]).toMatchObject({
      ref: "upload:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      clips: ["abrir"],
    });
  });

  it("toPublicRuntimeModel conserva los campos 3D", () => {
    const model = toPublicRuntimeModel(toRuntimeModel(makeRoom3D()));
    expect(model.dimension).toBe("3d");
    expect(model.subroomsById.sala?.pieces).toHaveLength(4);
    expect(model.objectsById.arca?.transform?.yaw).toBe(180);
    expect(Object.keys(model.customModels)).toEqual(["suelo-test", "arca-test"]);
  });

  it("la antorcha conserva su altura", () => {
    const model = toRuntimeModel(
      with3D((pkg) => {
        pkg.map.rooms[0]!.lighting.push({ type: "torch", x: 1, y: 1, h: 2.2 });
      }),
    );
    expect(model.subroomsById.sala?.lighting[1]).toMatchObject({ type: "torch", h: 2.2 });
  });

  it("un spawn fraccionario y un objeto con transform.x = cols - 0.2 cargan", () => {
    const model = toRuntimeModel(
      with3D((pkg) => {
        pkg.map.rooms[0]!.spawnPoints = [{ id: "spawn-1", x: 2.5, y: 3.5, h: 1, yaw: 0 }];
        pkg.objects[0]!.transform = { x: 3.8, y: 2, h: 0, yaw: 0 };
        pkg.objects[0]!.position = { x: 4, y: 2 }; // round(3.8) = 4 = cols
      }),
    );
    expect(model.subroomsById.sala?.spawns[0]).toMatchObject({ x: 2.5, y: 3.5, h: 1 });
    expect(model.objectsById.arca?.position).toEqual({ x: 4, y: 2 });
  });

  it("los bordes de la caja (x = cols, y = rows, h = 32) son válidos", () => {
    expect(() =>
      toRuntimeModel(
        with3D((pkg) => {
          pkg.objects[0]!.transform = { x: 4, y: 4, h: 32, yaw: 0 };
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    ["objeto con x = cols + 0.1", (pkg: RoomPackage) => {
      pkg.objects[0]!.transform = { x: 4.1, y: 1, h: 0, yaw: 0 };
    }],
    ["objeto con h > 32", (pkg: RoomPackage) => {
      pkg.objects[0]!.transform = { x: 1, y: 1, h: 32.5, yaw: 0 };
    }],
    ["spawn fuera", (pkg: RoomPackage) => {
      pkg.map.rooms[0]!.spawnPoints = [{ id: "spawn-1", x: 4.1, y: 1, h: 0, yaw: 0 }];
    }],
    ["spawn con y negativa", (pkg: RoomPackage) => {
      pkg.map.rooms[0]!.spawnPoints = [{ id: "spawn-1", x: 1, y: -0.1, h: 0, yaw: 0 }];
    }],
    ["pieza fuera", (pkg: RoomPackage) => {
      pkg.world3d!.rooms.sala!.pieces[0]!.x = 4.5;
    }],
  ])("%s lanza RoomPackageLoadError", (_name, edit) => {
    expect(() => toRuntimeModel(with3D(edit))).toThrow(RoomPackageLoadError);
  });

  it("el Rey Aldric (2D) lleva dimension 2d, pieces vacías y customModels vacío", () => {
    const model = toRuntimeModel(aldric);
    expect(model.dimension).toBe("2d");
    expect(model.customModels).toEqual({});
    for (const room of model.subrooms) expect(room.pieces).toEqual([]);
    for (const room of model.subrooms) {
      for (const spawn of room.spawns) expect(spawn).toMatchObject({ h: 0, yaw: 0 });
    }
    expect(model.objects.every((object) => object.transform === undefined)).toBe(true);
  });

  it("en 2D la rejilla sigue exigiendo celdas enteras", () => {
    const pkg = structuredClone(aldric);
    pkg.map.rooms[0]!.spawnPoints[0]!.x = 1.5;
    expect(() => toRuntimeModel(pkg)).toThrow(RoomPackageLoadError);
  });
});
