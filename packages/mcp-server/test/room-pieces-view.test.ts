import type { Models3DCatalog } from "@escaperoom/shared/packs";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import { describe, expect, it } from "vitest";
import { omittedNote, pieceCategory, splitFloorsAndWalls } from "../src/room-pieces-view";

type Entry = Models3DCatalog["models"][string];
const entry = (category: Entry["category"]): Entry => ({
  file: "models/x.glb",
  category,
  label: { es: { text: "x" } },
  size: { w: 1, d: 1, hgt: 1 },
  colliders: [],
  snap: true,
  clips: [],
});

const CATALOG = {
  packId: "test",
  version: "1",
  models: {
    "suelo-a": entry("suelo"),
    "suelo-b": entry("suelo"),
    "muro-a": entry("muro"),
    "columna-a": entry("estructura"),
  },
  avatars: {},
} as unknown as Models3DCatalog;

const piece = (id: string, model: string) => ({ id, model, x: 0.5, y: 0.5, h: 0, yaw: 0 });

function pkg3d(): RoomPackage {
  return {
    meta: { dimension: "3d" },
    map: { tileset: "test", rooms: [] },
    world3d: {
      models: { "mi-arca": { size: { w: 1, d: 1, hgt: 1 }, colliders: [], clips: [] } },
      rooms: {
        salon: {
          pieces: [
            piece("p-00000001", "suelo-a"),
            piece("p-00000002", "suelo-a"),
            piece("p-00000003", "suelo-b"),
            piece("p-00000004", "muro-a"),
            piece("p-00000005", "columna-a"),
            piece("p-00000006", "mi-arca"),
            piece("p-00000007", "modelo-raro"),
          ],
        },
        bodega: { pieces: [piece("p-00000008", "muro-a")] },
        vacia: { pieces: [piece("p-00000009", "columna-a")] },
      },
    },
  } as unknown as RoomPackage;
}

describe("splitFloorsAndWalls (7.11)", () => {
  it("omite suelo y muro del catálogo y conserva estructura, propios y desconocidos", () => {
    const { room, omittedTotal } = splitFloorsAndWalls(pkg3d(), CATALOG);
    expect(omittedTotal).toBe(5);
    expect(room.world3d!.rooms.salon!.pieces.map((p) => p.id)).toEqual([
      "p-00000005",
      "p-00000006",
      "p-00000007",
    ]);
    expect(room.world3d!.rooms.bodega!.pieces).toEqual([]);
    expect(room.world3d!.rooms.vacia!.pieces).toHaveLength(1);
    expect(room.world3d!.models).toEqual(pkg3d().world3d!.models);
  });

  it("cuenta por habitación y por modelo, solo las habitaciones con algo omitido", () => {
    const { omitted } = splitFloorsAndWalls(pkg3d(), CATALOG);
    expect(omitted).toEqual({
      salon: {
        suelo: { count: 3, models: { "suelo-a": 2, "suelo-b": 1 } },
        muro: { count: 1, models: { "muro-a": 1 } },
      },
      bodega: { suelo: { count: 0, models: {} }, muro: { count: 1, models: { "muro-a": 1 } } },
    });
  });

  it("no muta el paquete de entrada", () => {
    const input = pkg3d();
    splitFloorsAndWalls(input, CATALOG);
    expect(input).toEqual(pkg3d());
  });

  it("sin catálogo no omite nada (todo es desconocido)", () => {
    const input = pkg3d();
    const result = splitFloorsAndWalls(input, undefined);
    expect(result.omittedTotal).toBe(0);
    expect(result.room).toBe(input);
  });

  it("una sala 2D (sin world3d) sale igual y omittedTotal es 0", () => {
    const input = { meta: {}, map: { tileset: "test", rooms: [] } } as unknown as RoomPackage;
    const result = splitFloorsAndWalls(input, CATALOG);
    expect(result).toEqual({ room: input, omitted: {}, omittedTotal: 0 });
    expect(result.room).toBe(input);
  });

  it("un modelo propio con el id de uno del catálogo manda el propio (no se omite)", () => {
    const input = pkg3d();
    input.world3d!.models["suelo-a"] = { size: { w: 1, d: 1, hgt: 1 }, colliders: [], clips: [] } as never;
    expect(pieceCategory("suelo-a", CATALOG, input.world3d!.models)).toBe("propio");
    expect(splitFloorsAndWalls(input, CATALOG).omittedTotal).toBe(3);
  });

  it("la nota resume por habitación", () => {
    const { omitted, omittedTotal } = splitFloorsAndWalls(pkg3d(), CATALOG);
    const note = omittedNote(omitted, omittedTotal);
    expect(note).toContain("Omitidas 5 piezas de suelo y muro");
    expect(note).toContain("salon: 3 suelos, 1 muros; bodega: 0 suelos, 1 muros");
    expect(note).toContain("includeFloorsAndWalls: true");
  });
});
