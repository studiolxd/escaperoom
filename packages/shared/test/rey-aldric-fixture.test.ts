import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRoomPackage } from "../src/schemas";

/**
 * Coherencia geométrica del fixture del Rey Aldric (ticket 2.8). El loader
 * tolera RLE que no cubren la rejilla exacta (rellena o recorta), así que un
 * desajuste pasaba desapercibido: la capa `ground` de `catacumbas` traía 420
 * celdas para un 20×20 y la capa `walls` del Salón 260 para un 20×14 (lo que
 * dejaba la puerta de la Bodega una fila por encima de su objeto).
 */

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const room = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

/** Desempaqueta un RLE `[cantidad, tileId, ...]`. */
function unpack(rle: number[]): number[] {
  const tiles: number[] = [];
  for (let i = 0; i < rle.length; i += 2) {
    for (let n = 0; n < rle[i]!; n += 1) tiles.push(rle[i + 1]!);
  }
  return tiles;
}

describe("fixture Rey Aldric — capas de tilemap", () => {
  for (const subroom of room.map.rooms) {
    const { cols, rows } = subroom.grid;
    for (const layer of subroom.layers) {
      it(`${subroom.id}/${layer.name}: el RLE cubre exactamente ${cols}×${rows} celdas`, () => {
        expect(layer.rle.length % 2).toBe(0);
        expect(layer.rle.filter((_, i) => i % 2 === 0).every((count) => count > 0)).toBe(true);
        expect(unpack(layer.rle)).toHaveLength(cols * rows);
      });
    }
  }

  it("todos los objetos, spawns, luces y decoraciones caen dentro de su rejilla", () => {
    for (const subroom of room.map.rooms) {
      const { cols, rows } = subroom.grid;
      const inside = (x: number, y: number): boolean => x >= 0 && x < cols && y >= 0 && y < rows;
      for (const object of room.objects.filter((candidate) => candidate.roomId === subroom.id)) {
        expect(inside(object.position.x, object.position.y), object.id).toBe(true);
      }
      for (const point of [...subroom.spawnPoints, ...subroom.decorations]) {
        expect(inside(point.x, point.y), `${subroom.id} (${point.x},${point.y})`).toBe(true);
      }
      for (const light of subroom.lighting) {
        if (light.type === "torch") expect(inside(light.x, light.y)).toBe(true);
      }
    }
  });

  it("cada puerta del mundo está sobre un hueco de muro (tiles 20–22)", () => {
    for (const door of room.objects.filter((object) => object.leadsTo !== undefined)) {
      const subroom = room.map.rooms.find((candidate) => candidate.id === door.roomId)!;
      const walls = unpack(subroom.layers.find((layer) => layer.name === "walls")!.rle);
      const tile = walls[door.position.y * subroom.grid.cols + door.position.x];
      expect([20, 21, 22], door.id).toContain(tile);
    }
  });
});
