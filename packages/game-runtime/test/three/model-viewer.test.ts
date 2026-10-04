import { describe, expect, it } from "vitest";
import { ModelViewer } from "../../src/three/model-viewer";
import * as three from "../../src/three";

// Sin WebGL en Node: solo se comprueba la forma pública del módulo.
describe("ModelViewer", () => {
  it("el módulo exporta la clase y el índice la reexporta", () => {
    expect(typeof ModelViewer).toBe("function");
    expect(three.ModelViewer).toBe(ModelViewer);
    for (const method of ["load", "setMaterial", "setClip", "destroy"]) {
      expect(typeof ModelViewer.prototype[method as "load"]).toBe("function");
    }
  });
});
