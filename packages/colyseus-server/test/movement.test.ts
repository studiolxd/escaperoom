import { describe, expect, it } from "vitest";
import {
  MOVE_TOO_FAST,
  OUT_OF_BOUNDS,
  distance,
  isWithinBounds,
  validateMove,
  validateMove3D,
  type Move3DLimits,
  type MoveLimits,
  type Vector3,
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

describe("validateMove3D", () => {
  /** Navmesh simulada: un suelo cuadrado de 6 × 6 m a h = 0,1 (el pedido se ajusta a esa altura). */
  const floorLimits = (maxDistance = 1.5): Move3DLimits => ({
    maxDistance,
    closest: (p: Vector3) =>
      p.x >= 0 && p.x <= 6 && p.y >= 0 && p.y <= 6 && Math.abs(p.h - 0.1) <= 0.5
        ? { x: p.x, y: p.y, h: 0.1 }
        : null,
  });
  const current = { x: 3, y: 3, h: 0.1 };

  it("acepta un paso válido y devuelve el punto ajustado a la navmesh", () => {
    const result = validateMove3D(current, { x: 3.5, y: 3.5, h: 0 }, floorLimits());
    expect(result).toEqual({ ok: true, position: { x: 3.5, y: 3.5, h: 0.1 } });
  });

  it("rechaza un punto que no está en la navmesh con OUT_OF_BOUNDS", () => {
    expect(validateMove3D(current, { x: 7, y: 3, h: 0 }, floorLimits())).toEqual({
      ok: false,
      error: OUT_OF_BOUNDS,
    });
  });

  it("rechaza un salto superior al máximo con MOVE_TOO_FAST", () => {
    expect(validateMove3D(current, { x: 6, y: 3, h: 0 }, floorLimits())).toEqual({
      ok: false,
      error: MOVE_TOO_FAST,
    });
  });

  it("mide la distancia en 3D hasta el punto ajustado", () => {
    // 1,2 m en planta y 0,9 m en altura: 1,5 en 3D (justo en el umbral), 1,2 sin contar la altura.
    const tall: Move3DLimits = { maxDistance: 1.4, closest: (p) => p };
    expect(validateMove3D({ x: 0, y: 0, h: 0 }, { x: 1.2, y: 0, h: 0.9 }, tall)).toEqual({
      ok: false,
      error: MOVE_TOO_FAST,
    });
    expect(validateMove3D({ x: 0, y: 0, h: 0 }, { x: 1.2, y: 0, h: 0.5 }, tall).ok).toBe(true);
  });

  it("rechaza valores no finitos sin consultar la navmesh", () => {
    let calls = 0;
    const limits: Move3DLimits = { maxDistance: 1.5, closest: (p) => (calls++, p) };
    for (const requested of [
      { x: Number.NaN, y: 3, h: 0 },
      { x: 3, y: Number.POSITIVE_INFINITY, h: 0 },
      { x: 3, y: 3, h: Number.NaN },
    ]) {
      expect(validateMove3D(current, requested, limits)).toEqual({ ok: false, error: OUT_OF_BOUNDS });
    }
    expect(calls).toBe(0);
  });
});
