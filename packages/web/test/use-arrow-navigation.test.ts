import { describe, expect, it } from "vitest";
import { nextArrowIndex } from "../src/components/game-session/hooks/use-arrow-navigation";

describe("nextArrowIndex", () => {
  it("lista: cualquier flecha recorre y, con wrap, da la vuelta", () => {
    expect(nextArrowIndex("ArrowDown", 0, 3, 1, true)).toBe(1);
    expect(nextArrowIndex("ArrowRight", 2, 3, 1, true)).toBe(0);
    expect(nextArrowIndex("ArrowUp", 0, 3, 1, true)).toBe(2);
    expect(nextArrowIndex("ArrowLeft", 0, 3, 1, true)).toBe(2);
  });

  it("lista sin wrap: se queda en los extremos", () => {
    expect(nextArrowIndex("ArrowDown", 2, 3, 1, false)).toBe(2);
    expect(nextArrowIndex("ArrowUp", 0, 3, 1, false)).toBe(0);
  });

  it("rejilla: izq./der. dentro de su fila, arriba/abajo saltan una fila, sin vuelta", () => {
    expect(nextArrowIndex("ArrowLeft", 3, 7, 3, false)).toBe(3);
    expect(nextArrowIndex("ArrowRight", 5, 7, 3, false)).toBe(5);
    expect(nextArrowIndex("ArrowRight", 6, 7, 3, false)).toBe(6);
    expect(nextArrowIndex("ArrowDown", 1, 7, 3, false)).toBe(4);
    expect(nextArrowIndex("ArrowDown", 4, 7, 3, false)).toBe(4);
    expect(nextArrowIndex("ArrowUp", 4, 7, 3, false)).toBe(1);
    expect(nextArrowIndex("ArrowUp", 1, 7, 3, false)).toBe(1);
  });

  it("sin opciones devuelve -1", () => {
    expect(nextArrowIndex("ArrowDown", 0, 0, 3, false)).toBe(-1);
  });
});
