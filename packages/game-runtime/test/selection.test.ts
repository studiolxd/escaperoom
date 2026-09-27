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

  it("con `facing`, ignora un objeto más cercano que queda a la espalda", () => {
    const objects = [object("delante", 1, 5), object("detras", -1, 5)];
    // Mirando hacia +x: "detras" (-x) queda a la espalda y se descarta pese a
    // estar a la misma distancia — tecla Espacio, revisión en vivo.
    expect(nearestInteractable(objects, { x: 0, y: 5 }, { facing: { x: 1, y: 0 } })?.id).toBe(
      "delante",
    );
  });

  it("con `facing`, un objeto justo perpendicular sigue contando (semiplano, no cono estrecho)", () => {
    const objects = [object("lado", 0, 6)];
    expect(nearestInteractable(objects, { x: 0, y: 5 }, { facing: { x: 1, y: 0 } })?.id).toBe(
      "lado",
    );
  });

  it("sin `facing`, el filtro de dirección no aplica (drag&drop de items, omnidireccional)", () => {
    const objects = [object("detras", -1, 5)];
    expect(nearestInteractable(objects, { x: 0, y: 5 })?.id).toBe("detras");
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

  it("descarta la celda adyacente más cercana si está aislada (BFS, no solo distancia)", () => {
    // Anillo bloqueado alrededor de (4,5): esa celda es caminable pero
    // inalcanzable desde cualquier otro punto (sus 8 vecinos están todos
    // bloqueados). Es la celda MÁS CERCANA al avatar entre las candidatas de
    // `target`, así que la vieja heurística de "rectángulo delimitador"
    // (que también fallaba para ella, por (3,5) bloqueado de por medio) caía
    // a "la más cercana sin más" y devolvía igualmente esa celda inalcanzable
    // — el bug real de la revisión en vivo (avatar clavado contra un
    // obstáculo con el destino "detrás"). Con BFS real debe saltarse a la
    // siguiente candidata que sí tiene un camino de verdad, aunque dé un
    // rodeo.
    const blocked = new Set([
      "3,4",
      "4,4",
      "5,4",
      "3,5",
      "5,5",
      "3,6",
      "4,6",
      "5,6",
    ]);
    const isWalkable = (x: number, y: number) =>
      x >= 0 && x <= 10 && y >= 0 && y <= 10 && !blocked.has(`${x},${y}`);
    expect(approachCell({ x: 5, y: 5 }, { x: 0, y: 5 }, isWalkable)).toEqual({ x: 6, y: 5 });
  });
});
