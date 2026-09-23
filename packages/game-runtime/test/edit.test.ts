import { describe, expect, it } from "vitest";
import {
  EDIT_EVENT,
  EDITOR_LAYERS,
  RUNTIME_MODE,
  buildEditorPalette,
  buildPlaceholderManifest,
  loadRuntimeModel,
} from "../src";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixture = readFileSync(
  fileURLToPath(new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url)),
  "utf8",
);

describe("modo edición — palette del pack", () => {
  const manifest = {
    id: "medieval-v1",
    tiles: {
      "10": { frame: "tile-10", collides: true },
      "2": { frame: "tile-2", collides: false },
      "1": { frame: "tile-1", collides: false },
    },
    sprites: {
      trono: { frame: "trono" },
      arca: { frame: "arca" },
    },
  };

  it("ordena tiles y sprites y propone capa según la colisión del manifiesto", () => {
    const palette = buildEditorPalette(manifest);
    expect(palette.packId).toBe("medieval-v1");
    expect(palette.tiles.map((t) => [t.tileId, t.layer])).toEqual([
      [1, "ground"],
      [2, "ground"],
      [10, "walls"],
    ]);
    expect(palette.sprites.map((s) => s.sprite)).toEqual(["arca", "trono"]);
  });

  it("añade miniaturas si se conocen", () => {
    const palette = buildEditorPalette(manifest, {
      thumbnail: (kind, frame) => (frame === "arca" ? undefined : `/packs/x/${kind}/${frame}.svg`),
    });
    expect(palette.tiles[0]?.thumbnail).toBe("/packs/x/tiles/tile-1.svg");
    expect(palette.sprites[0]).toEqual({ sprite: "arca", frame: "arca" });
    expect(palette.sprites[1]?.thumbnail).toBe("/packs/x/sprites/trono.svg");
  });

  it("acepta el manifiesto completo (también el placeholder derivado del modelo)", () => {
    const palette = buildEditorPalette(buildPlaceholderManifest(loadRuntimeModel(fixture)));
    expect(palette.tiles.map((t) => t.tileId)).toEqual([1, 2, 3, 10, 20, 21, 22]);
    expect(palette.tiles.find((t) => t.tileId === 10)?.layer).toBe("walls");
    expect(palette.sprites.map((s) => s.sprite)).toContain("trono");
  });

  it("expone las capas del editor, el modo y el nombre del evento", () => {
    expect(EDITOR_LAYERS).toEqual(["ground", "walls", "decor"]);
    expect(RUNTIME_MODE.edit).toBe("edit");
    expect(EDIT_EVENT).toBe("edit:event");
  });
});
