import { describe, expect, it } from "vitest";
import { buildNavInput, buildNavInputFromParts } from "../src";
import { floor, room, TEST_CATALOG, testObject } from "./fixtures/catalog";

describe("buildNavInputFromParts", () => {
  it("da la misma entrada que buildNavInput para una sala equivalente", () => {
    const pkg = room(
      [...floor(3, 3), { model: "rampa", x: 1.5, y: 1, h: 0, yaw: 90, scale: 1.5 }],
      [
        testObject({ id: "mesa", at: { x: 1.2, y: 2.1 }, sprite: "tarima", states: { a: "tarima" } }),
        testObject({ id: "puerta", type: "puerta", at: { x: 2, y: 2 } }),
      ],
    );
    const expected = buildNavInput(pkg, "sala", TEST_CATALOG);
    const actual = buildNavInputFromParts({
      pieces: pkg.world3d!.rooms.sala!.pieces,
      objects: [{ modelId: "tarima", transform: pkg.objects[0]!.transform! }],
      catalog: TEST_CATALOG,
      customModels: pkg.world3d?.models,
    });
    expect(Array.from(actual.positions)).toEqual(Array.from(expected.positions));
    expect(Array.from(actual.indices)).toEqual(Array.from(expected.indices));
  });

  it("resuelve modelos propios (customModels) antes que el catálogo", () => {
    const input = buildNavInputFromParts({
      pieces: [{ id: "p-00000000", model: "propio", x: 0, y: 0, h: 0, yaw: 0 }],
      objects: [],
      catalog: TEST_CATALOG,
      customModels: {
        propio: { size: { w: 1, d: 1, hgt: 1 }, colliders: [{ type: "box", cx: 0, cy: 0, ch: 0.5, sx: 1, sy: 1, sh: 1 }] },
      },
    });
    expect(input.indices.length).toBe(36);
  });
});
