import { describe, expect, it } from "vitest";
import { normalizeDirection, stepTowards } from "../src/lib/lobby-movement";

describe("stepTowards", () => {
  it("avanza exactamente maxStep hacia el objetivo", () => {
    const next = stepTowards({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.4);
    expect(next.x).toBeCloseTo(0.4, 5);
    expect(next.y).toBeCloseTo(0, 5);
  });

  it("no se pasa del objetivo cuando está más cerca que maxStep", () => {
    expect(stepTowards({ x: 0, y: 0 }, { x: 0.2, y: 0.1 }, 0.4)).toEqual({ x: 0.2, y: 0.1 });
  });

  it("respeta la diagonal (paso de longitud maxStep)", () => {
    const next = stepTowards({ x: 0, y: 0 }, { x: 3, y: 3 }, 0.5);
    expect(Math.hypot(next.x, next.y)).toBeCloseTo(0.5, 5);
  });
});

describe("normalizeDirection", () => {
  it("normaliza a longitud 1", () => {
    const dir = normalizeDirection(1, 1);
    expect(dir).not.toBeNull();
    expect(Math.hypot(dir!.x, dir!.y)).toBeCloseTo(1, 5);
  });

  it("devuelve null si no hay dirección", () => {
    expect(normalizeDirection(0, 0)).toBeNull();
  });
});
