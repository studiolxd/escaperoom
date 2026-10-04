import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRoomPackage } from "@escaperoom/shared/schemas";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { roomDocToPackage, roomPackageToDoc } from "../src";
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

describe("códec del documento en 3D", () => {
  it("un paquete 3D sobrevive a la ida y vuelta por el documento", () => {
    const pkg = makeRoom3D();
    expect(roomDocToPackage(roomPackageToDoc(pkg))).toEqual(pkg);
  });

  it("el paquete 3D también sobrevive a una réplica por updates binarios", () => {
    const pkg = makeRoom3D();
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(roomPackageToDoc(pkg)));
    expect(roomDocToPackage(copy)).toEqual(pkg);
  });

  it("el Rey Aldric 2D no gana `dimension` ni `world3d`", () => {
    const back = roomDocToPackage(roomPackageToDoc(aldric));
    expect(back).toEqual(aldric);
    expect(back.meta).not.toHaveProperty("dimension");
    expect(back).not.toHaveProperty("world3d");
  });

  it("incluye una entrada por habitación aunque no tenga piezas", () => {
    const pkg = makeRoom3D();
    pkg.world3d = { rooms: { sala: { pieces: [] } }, models: {} };
    expect(roomDocToPackage(roomPackageToDoc(pkg)).world3d?.rooms).toEqual({
      sala: { pieces: [] },
    });
  });
});
