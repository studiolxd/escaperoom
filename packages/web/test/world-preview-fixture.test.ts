import { describe, expect, it } from "vitest";
import {
  collectContainer,
  createContainerStateMap,
  createObjectStateMap,
  inspectObject,
  loadRoomPackage,
  setObjectState,
  toRuntimeModel,
  type RuntimeModel,
} from "@escaperoom/game-runtime";
import { worldPreviewPackage } from "../src/lib/world-preview-fixture";

function loadModel(locale?: string): RuntimeModel {
  return toRuntimeModel(loadRoomPackage(worldPreviewPackage()), locale ? { locale } : {});
}

describe("world-preview fixture (ticket 1.3)", () => {
  it("valida contra el contrato y proyecta la sala de demo", () => {
    const model = loadModel();
    expect(model.meta.id).toBe("room-world-preview");
    expect(model.subrooms).toHaveLength(1);
    expect(model.objectsById["cofre"]?.inventory).toEqual(["llave-bronce", "moneda", "antorcha"]);
  });

  it("mantiene el inventario del cofre como lógica pura", () => {
    const model = loadModel();
    const cofre = model.objectsById["cofre"];
    if (!cofre) throw new Error("falta el cofre");

    const result = collectContainer(createContainerStateMap(model), cofre, { openerId: "p1" });
    expect(result.grants).toEqual({ p1: ["llave-bronce", "moneda", "antorcha"] });
  });

  it("resuelve diálogos es/en y el estado con animación", () => {
    const model = loadModel("en");
    expect(inspectObject(model, "cuadro")?.dialog?.text).toContain("portrait");
    expect(model.objectsById["cofre"]?.animationByState).toEqual({ open: "slide_up" });

    const cofre = model.objectsById["cofre"];
    if (!cofre) throw new Error("falta el cofre");
    const next = setObjectState(createObjectStateMap(model), cofre, "open");
    expect(next["cofre"]).toBe("open");
  });
});
