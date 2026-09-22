import { describe, expect, it } from "vitest";
import { buildAtlasJson, packAtlas, type AtlasFrameInput } from "../src/pack/atlas";
import { decodePng, encodePng } from "../src/pack/png";

function solid(width: number, height: number, color: [number, number, number, number]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = color[0];
    rgba[i * 4 + 1] = color[1];
    rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = color[3];
  }
  return rgba;
}

describe("códec PNG", () => {
  it("hace round-trip de una imagen RGBA-8", () => {
    const rgba = solid(3, 2, [10, 20, 30, 200]);
    rgba[0] = 255;
    rgba[1] = 128;

    const decoded = decodePng(encodePng({ width: 3, height: 2, rgba }));
    expect(decoded.width).toBe(3);
    expect(decoded.height).toBe(2);
    expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
  });
});

describe("packAtlas", () => {
  it("compone un atlas sin solapes y conserva los píxeles", () => {
    const frames: AtlasFrameInput[] = [
      { frame: "a", width: 4, height: 4, rgba: solid(4, 4, [255, 0, 0, 255]) },
      { frame: "b", width: 2, height: 2, rgba: solid(2, 2, [0, 255, 0, 255]) },
    ];

    const atlas = packAtlas(frames, { maxWidth: 8, padding: 1 });
    expect(atlas.frames).toHaveLength(2);
    expect(atlas.width).toBeGreaterThanOrEqual(4);
    expect(atlas.height).toBeGreaterThanOrEqual(4);

    for (const frame of atlas.frames) {
      const offset = (frame.y * atlas.width + frame.x) * 4;
      const expected = frame.frame === "a" ? [255, 0, 0, 255] : [0, 255, 0, 255];
      expect(Array.from(atlas.rgba.slice(offset, offset + 4))).toEqual(expected);
    }

    const [a, b] = atlas.frames;
    if (a && b) {
      const overlap =
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap).toBe(false);
    }
  });

  it("genera JSON de Phaser con frames y meta", () => {
    const atlas = packAtlas([
      { frame: "tile-1", width: 64, height: 32, rgba: solid(64, 32, [1, 2, 3, 255]) },
    ]);
    const json = buildAtlasJson("atlas-tiles.png", atlas) as {
      frames: Record<string, { frame: { w: number; h: number } }>;
      meta: { image: string; size: { w: number; h: number } };
    };

    expect(json.frames["tile-1"]?.frame.w).toBe(64);
    expect(json.frames["tile-1"]?.frame.h).toBe(32);
    expect(json.meta.image).toBe("atlas-tiles.png");
    expect(json.meta.size.w).toBe(atlas.width);
  });
});
