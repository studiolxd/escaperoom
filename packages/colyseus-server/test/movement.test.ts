import { describe, expect, it } from "vitest";
import {
  MOVE_TOO_FAST,
  OUT_OF_BOUNDS,
  distance,
  isWithinBounds,
  validateMove,
  type MoveLimits,
} from "../src/movement";

const bounds = { minX: 0, minY: 0, maxX: 9, maxY: 9 } as const;
const limits: MoveLimits = { maxDistance: 0.5, bounds };

describe("validateMove", () => {
  it("acepta un paso válido dentro del umbral", () => {
    const result = validateMove({ x: 2, y: 2 }, { x: 2.4, y: 2.3 }, limits);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.position).toEqual({ x: 2.4, y: 2.3 });
    }
  });

  it("acepta un paso justo en el umbral", () => {
    const result = validateMove({ x: 0, y: 0 }, { x: 0.5, y: 0 }, limits);
    expect(result.ok).toBe(true);
  });

  it("rechaza un salto mayor que el umbral (anti-teletransporte)", () => {
    expect(validateMove({ x: 2, y: 2 }, { x: 9, y: 9 }, limits)).toEqual({
      ok: false,
      error: MOVE_TOO_FAST,
    });
  });

  it("rechaza una posición fuera del grid", () => {
    expect(validateMove({ x: 0, y: 0 }, { x: -0.1, y: 0 }, limits)).toEqual({
      ok: false,
      error: OUT_OF_BOUNDS,
    });
    expect(validateMove({ x: 0, y: 0 }, { x: 0, y: 12 }, limits)).toEqual({
      ok: false,
      error: OUT_OF_BOUNDS,
    });
  });

  it("rechaza coordenadas no finitas", () => {
    expect(validateMove({ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, limits)).toEqual({
      ok: false,
      error: OUT_OF_BOUNDS,
    });
  });
});

describe("distance", () => {
  it("mide la distancia euclídea", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("isWithinBounds", () => {
  it("incluye los bordes", () => {
    expect(isWithinBounds({ x: 0, y: 0 }, bounds)).toBe(true);
    expect(isWithinBounds({ x: 9, y: 9 }, bounds)).toBe(true);
    expect(isWithinBounds({ x: 9.1, y: 9 }, bounds)).toBe(false);
  });
});
