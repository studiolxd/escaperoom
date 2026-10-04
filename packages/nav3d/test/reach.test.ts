import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { getModels3DCatalog } from "@escaperoom/shared/packs";
import { parseRoomPackage } from "@escaperoom/shared/schemas";
import { checkRoomReach, initNav3D } from "../src";
import { floor, room, testObject, TEST_CATALOG, type TestPiece } from "./fixtures/catalog";

beforeAll(async () => {
  await initNav3D();
});

/** Anillo de muros de 1 m: borde del cuadrado de lado `size` con esquina en (x0, y0). */
function ring(x0: number, y0: number, size: number): TestPiece[] {
  const out: TestPiece[] = [];
  for (let i = 0; i < size; i++) {
    out.push({ model: "muro", x: x0 + i + 0.5, y: y0 + 0.5 });
    out.push({ model: "muro", x: x0 + i + 0.5, y: y0 + size - 0.5 });
    if (i > 0 && i < size - 1) {
      out.push({ model: "muro", x: x0 + 0.5, y: y0 + i + 0.5 });
      out.push({ model: "muro", x: x0 + size - 0.5, y: y0 + i + 0.5 });
    }
  }
  return out;
}

describe("checkRoomReach", () => {
  it("una sala abierta con spawn y objeto alcanzables no da avisos", () => {
    const pkg = room(floor(8, 8), [testObject({ id: "arca", at: { x: 5, y: 5 }, interactable: true })]);
    expect(checkRoomReach(pkg, "sala", TEST_CATALOG)).toEqual([]);
  });

  it("avisa de un spawn fuera de la navmesh", () => {
    const pkg = room(floor(4, 4));
    pkg.map.rooms[0]!.spawnPoints = [
      { id: "spawn-1", x: 1.5, y: 1.5, h: 0, yaw: 0 },
      { id: "spawn-2", x: 15, y: 15, h: 0, yaw: 0 },
    ];
    expect(checkRoomReach(pkg, "sala", TEST_CATALOG)).toEqual([
      { code: "spawn_off_navmesh", spawnId: "spawn-2" },
    ]);
  });

  it("avisa de un objeto interactuable encerrado tras un muro cerrado", () => {
    const pkg = room(
      [...floor(12, 12), ...ring(4, 4, 6)],
      [
        testObject({ id: "encerrado", at: { x: 7, y: 7 }, interactable: true }),
        testObject({ id: "libre", at: { x: 1.5, y: 10.5 }, interactable: true }),
        testObject({ id: "decorado", at: { x: 7.5, y: 7.5 }, interactable: false }),
      ],
    );
    pkg.map.rooms[0]!.spawnPoints = [{ id: "spawn-1", x: 1.5, y: 1.5, h: 0, yaw: 0 }];
    expect(checkRoomReach(pkg, "sala", TEST_CATALOG)).toEqual([
      { code: "object_unreachable", objectId: "encerrado" },
    ]);
  });

  it("una habitación sin suelo da solo no_floor", () => {
    const pkg = room([], [testObject({ id: "arca", at: { x: 5, y: 5 }, interactable: true })]);
    expect(checkRoomReach(pkg, "sala", TEST_CATALOG)).toEqual([{ code: "no_floor" }]);
  });

  it("la sala de pruebas 3D no tiene avisos", () => {
    const fixture = fileURLToPath(
      new URL("../../../docs/reference/roompackage-demo-3d.v1.json", import.meta.url),
    );
    const pkg = parseRoomPackage(JSON.parse(readFileSync(fixture, "utf8")) as unknown);
    const catalog = getModels3DCatalog("medieval-v1");
    for (const r of pkg.map.rooms) expect(checkRoomReach(pkg, r.id, catalog), r.id).toEqual([]);
  });
});
