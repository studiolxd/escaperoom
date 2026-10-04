import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { getModels3DCatalog } from "@escaperoom/shared/packs";
import { parseRoomPackage } from "@escaperoom/shared/schemas";
import { checkRoomReach, initNav3D } from "../src";

/** «La Maldición del Rey Aldric» en 3D (encargo 7.10b): alcance de cada habitación sobre la navmesh del catálogo real. */

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric-3d.v1.json", import.meta.url),
);
const pkg = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);
const catalog = getModels3DCatalog("medieval-v1");

beforeAll(async () => {
  await initNav3D();
});

describe("Rey Aldric 3D — alcance", () => {
  for (const room of pkg.map.rooms) {
    it(`${room.id}: hay suelo y todos los spawns están sobre la navmesh`, () => {
      const issues = checkRoomReach(pkg, room.id, catalog);
      expect(issues.filter((i) => i.code === "no_floor" || i.code === "spawn_off_navmesh")).toEqual([]);
    });

    it(`${room.id}: ningún objeto interactuable queda encerrado`, () => {
      expect(checkRoomReach(pkg, room.id, catalog).filter((i) => i.code === "object_unreachable")).toEqual([]);
    });
  }
});
