import { describe, expect, it } from "vitest";
import {
  approachCell,
  nearestInteractable,
  nearestInteractableId,
  type SelectableObject,
} from "../src/world/selection";

/**
 * Selección de objeto fiable (ticket 1.14, bug del playtest): acercarse al
 * brasero debe resolver el brasero y no saltar a la placa. El desempate es
 * estable por `id`, así que el orden del array no cambia el resultado.
 */

function object(id: string, x: number, y: number, interactable = true): SelectableObject {
  return { id, position: { x, y }, interactable };
}

const SALON = [
  object("placa-der", 14, 11),
  object("placa-izq", 6, 11),
  object("brasero", 4, 6),
  object("trono", 10, 1),
];

describe("nearestInteractable", () => {
  it("resuelve el brasero al acercarse a su celda, no la placa", () => {
    expect(nearestInteractableId(SALON, { x: 4, y: 7 })).toBe("brasero");
    expect(nearestInteractableId(SALON, { x: 5, y: 6 })).toBe("brasero");
  });

  it("no devuelve objetos fuera del radio de interacción", () => {
    expect(nearestInteractableId(SALON, { x: 10, y: 8 })).toBeUndefined();
  });

  it("ignora objetos no interactuables", () => {
    const objects = [object("decorativo", 4, 7, false), object("brasero", 4, 6)];
    expect(nearestInteractableId(objects, { x: 4, y: 7 })).toBe("brasero");
  });

  it("desempata de forma estable por id a igual distancia", () => {
    const a = object("placa-der", 5, 7);
    const b = object("brasero", 3, 7);
    expect(nearestInteractableId([a, b], { x: 4, y: 7 })).toBe("brasero");
    expect(nearestInteractableId([b, a], { x: 4, y: 7 })).toBe("brasero");
  });

  it("devuelve el objeto completo (no solo el id)", () => {
    expect(nearestInteractable(SALON, { x: 4, y: 7 })?.id).toBe("brasero");
  });
});

describe("approachCell", () => {
  const isWalkable = (x: number, y: number) =>
    x >= 1 && x <= 18 && y >= 1 && y <= 12;

  it("elige una celda adyacente caminable más cercana al avatar", () => {
    expect(approachCell({ x: 6, y: 0 }, { x: 6, y: 3 }, isWalkable)).toEqual({ x: 6, y: 1 });
  });

  it("devuelve undefined si no hay ninguna celda adyacente caminable", () => {
    expect(approachCell({ x: 0, y: 0 }, { x: 2, y: 2 }, () => false)).toBeUndefined();
  });
});
