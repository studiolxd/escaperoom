import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createObjectStateMap,
  reactiveObjectIds,
  resolveTorchLights,
  resolveWaterChannels,
  setObjectState,
  type RuntimeModel,
} from "../src";
import { loadRoomPackage, toRuntimeModel } from "../src/loader";

/**
 * Mundo reactivo del Rey Aldric (ticket 2.8): antorchas que dependen de
 * objetos (brasero, `mesa-catas`) y el canal de agua `canal-entrada → altar`.
 */

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const model: RuntimeModel = toRuntimeModel(loadRoomPackage(readFileSync(fixturePath, "utf8")));

function withState(objectId: string, state: string) {
  return setObjectState(createObjectStateMap(model), model.objectsById[objectId]!, state);
}

describe("iluminación reactiva", () => {
  it("la antorcha del Salón depende del brasero", () => {
    const initial = resolveTorchLights(model, "salon-trono", createObjectStateMap(model));
    expect(initial).toEqual([{ x: 5, y: 1, lit: false, drivenBy: "brasero" }]);
    const lit = resolveTorchLights(model, "salon-trono", withState("brasero", "lit"));
    expect(lit[0]?.lit).toBe(true);
  });

  it("las antorchas de la escalera de la Bodega se encienden con la mesa de catas activa", () => {
    const idle = resolveTorchLights(model, "bodega", createObjectStateMap(model));
    expect(idle).toHaveLength(2);
    expect(idle.every((torch) => !torch.lit && torch.drivenBy === "mesa-catas")).toBe(true);
    const active = resolveTorchLights(model, "bodega", withState("mesa-catas", "active"));
    expect(active.every((torch) => torch.lit)).toBe(true);
  });

  it("los objetos reactivos por habitación son los que gobiernan luces o agua", () => {
    expect([...reactiveObjectIds(model, "salon-trono")]).toEqual(["brasero"]);
    expect([...reactiveObjectIds(model, "bodega")]).toEqual(["mesa-catas"]);
    expect([...reactiveObjectIds(model, "catacumbas")]).toEqual(["altar"]);
  });
});

describe("canal de agua", () => {
  it("va de la entrada del canal al altar y fluye cuando el altar pasa a `flowing`", () => {
    const [dry] = resolveWaterChannels(model, "catacumbas", createObjectStateMap(model));
    expect(dry).toMatchObject({
      puzzleId: "p-canal-agua",
      fromObjectId: "canal-entrada",
      toObjectId: "altar",
      flowing: false,
    });
    expect(dry?.cells[0]).toEqual({ x: 2, y: 4 });
    expect(dry?.cells.at(-1)).toEqual({ x: 10, y: 4 });
    expect(dry?.cells).toHaveLength(9);

    const [wet] = resolveWaterChannels(model, "catacumbas", withState("altar", "flowing"));
    expect(wet?.flowing).toBe(true);
  });

  it("las habitaciones sin `pipes` no tienen canal", () => {
    expect(resolveWaterChannels(model, "bodega", createObjectStateMap(model))).toEqual([]);
  });
});
