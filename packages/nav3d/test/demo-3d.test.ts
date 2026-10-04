import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getModels3DCatalog } from "@escaperoom/shared/packs";
import { parseRoomPackage } from "@escaperoom/shared/schemas";
import { createRoomNavFor, initNav3D, type NavPoint, type RoomNav } from "../src";

/** Sala de pruebas 3D (encargo 7.6p §2.5): spawns y rutas sobre la navmesh del catálogo real. */

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-demo-3d.v1.json", import.meta.url),
);
const pkg = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);
const catalog = getModels3DCatalog("medieval-v1");

const navs = new Map<string, RoomNav>();
beforeAll(async () => {
  await initNav3D();
  for (const room of pkg.map.rooms) navs.set(room.id, createRoomNavFor(pkg, room.id, catalog));
});
afterAll(() => {
  for (const nav of navs.values()) nav.destroy();
});

const nav = (roomId: string): RoomNav => navs.get(roomId)!;
const spawnsOf = (roomId: string): NavPoint[] =>
  pkg.map.rooms.find((room) => room.id === roomId)!.spawnPoints.map((s) => ({ x: s.x, y: s.y, h: s.h ?? 0 }));
const objectAt = (id: string) => pkg.objects.find((o) => o.id === id)!.transform!;

describe("Sala de pruebas 3D — navmesh", () => {
  for (const roomId of ["antesala", "camara"]) {
    it(`${roomId}: los cuatro spawns están sobre la navmesh`, () => {
      const spawns = spawnsOf(roomId);
      expect(spawns).toHaveLength(4);
      for (const spawn of spawns) expect(nav(roomId).closest(spawn), JSON.stringify(spawn)).not.toBeNull();
    });
  }

  describe("antesala", () => {
    const from = spawnsOf("antesala")[0]!;
    // Punto a 1 m del objeto, del lado de la sala (el objeto bloquea su propia huella).
    const near = (id: string, dx: number, dy: number): NavPoint => {
      const t = objectAt(id);
      return { x: t.x + dx, y: t.y + dy, h: 0 };
    };

    it("hay ruta hasta un punto junto al arca", () => {
      expect(nav("antesala").path(from, near("arca", -1, 0))).not.toBeNull();
    });

    it("hay ruta hasta un punto junto al brasero", () => {
      expect(nav("antesala").path(from, near("brasero", 1, 0))).not.toBeNull();
    });

    it("hay ruta hasta un punto junto a la puerta", () => {
      expect(nav("antesala").path(from, near("puerta", 0, 1))).not.toBeNull();
    });
  });

  describe("camara", () => {
    it("hay ruta del spawn a la cima de la tarima, junto al trono", () => {
      const throne = objectAt("trono");
      const path = nav("camara").path(spawnsOf("camara")[0]!, { x: throne.x, y: throne.y + 1, h: 0.4 });
      expect(path).not.toBeNull();
      const end = path![path!.length - 1]!;
      expect(end.h).toBeGreaterThanOrEqual(0.35);
      expect(end.h).toBeLessThanOrEqual(0.6);
    });
  });
});
