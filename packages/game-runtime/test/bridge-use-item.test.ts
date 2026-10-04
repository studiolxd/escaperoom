import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRoomPackage, toRuntimeModel } from "../src/loader";
import { createLocalGameClient } from "../src/session";

/**
 * Objeto-puente (`soloBridgeItemId`) de `simultaneous_plates` y `split_clue`:
 * el cliente solo manda `use-item` al servidor si el objeto lo lista en
 * `useItemIds` (HUD y runtimes 2D/3D comparten esa puerta).
 */

const FIXTURES = {
  "2D": "roompackage-rey-aldric.v1.json",
  "3D": "roompackage-rey-aldric-3d.v1.json",
} as const;

function load(dimension: keyof typeof FIXTURES) {
  const path = fileURLToPath(new URL(`../../../docs/reference/${FIXTURES[dimension]}`, import.meta.url));
  return loadRoomPackage(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

describe.each(["2D", "3D"] as const)("objeto-puente en el Rey Aldric %s", (dimension) => {
  it("las placas de simultaneous_plates ofrecen el busto en useItemIds", () => {
    const model = toRuntimeModel(load(dimension));
    expect(model.objectsById["placa-izq"]?.useItemIds).toContain("busto-piedra");
    expect(model.objectsById["placa-der"]?.useItemIds).toContain("busto-piedra");
  });

  it("las mirillas de split_clue ofrecen su puente en useItemIds", () => {
    const roomPackage = load(dimension);
    const model = toRuntimeModel(roomPackage);
    const split = roomPackage.puzzles.find((p) => p.type === "split_clue" && p.soloBridgeItemId);
    expect(split).toBeDefined();
    if (!split || split.type !== "split_clue") return;
    for (const viewpoint of split.viewpoints) {
      expect(model.objectsById[viewpoint.objectId]?.useItemIds).toContain(split.soloBridgeItemId);
    }
  });

  it("usar el busto sobre una placa la fija y consume el busto (cliente local)", () => {
    const client = createLocalGameClient(load(dimension), { tickMs: false, now: () => 0 });
    client.startGame(true);
    client.enterMap();
    client.attempt("p-candado-arca", { code: "4732" });
    expect(client.getSnapshot().inventory).toContain("busto-piedra");
    client.useItem("busto-piedra", "placa-izq");
    expect(client.getSnapshot().inventory).not.toContain("busto-piedra");
  });
});
