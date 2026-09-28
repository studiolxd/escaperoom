import { describe, expect, it } from "vitest";
import { MAX_FRAME_ELAPSED_MS, MOVE_SUBSTEP_MS, movementSubsteps } from "../src/world";

const sum = (steps: number[]): number => steps.reduce((total, step) => total + step, 0);

describe("movementSubsteps (tiempo real del frame para mover avatares)", () => {
  it("a 60 fps, un solo paso con el tiempo real del frame", () => {
    expect(movementSubsteps(16.7)).toEqual([16.7]);
  });

  it("a pocos fps conserva TODO el tiempo real (no lo recorta a 16,7 ms como el delta de Phaser)", () => {
    // 8 fps: el avatar debe avanzar lo mismo por segundo que a 60 fps.
    const steps = movementSubsteps(125);
    expect(sum(steps)).toBeCloseTo(125);
    expect(steps.every((step) => step <= MOVE_SUBSTEP_MS)).toBe(true);
    expect(steps).toHaveLength(3);
  });

  it("trocea un frame largo en subpasos de como mucho MOVE_SUBSTEP_MS (colisión por celda)", () => {
    const steps = movementSubsteps(430);
    expect(sum(steps)).toBeCloseTo(430);
    expect(Math.max(...steps)).toBeLessThanOrEqual(MOVE_SUBSTEP_MS);
    // A 4 celdas/s, ningún subpaso mueve más de una fracción de celda.
    expect((4 * Math.max(...steps)) / 1000).toBeLessThan(0.5);
  });

  it("acota una pausa larga (pestaña que vuelve de dormir) a MAX_FRAME_ELAPSED_MS", () => {
    expect(sum(movementSubsteps(30_000))).toBeCloseTo(MAX_FRAME_ELAPSED_MS);
  });

  it("sin tiempo, negativo o no finito: sin pasos", () => {
    expect(movementSubsteps(0)).toEqual([]);
    expect(movementSubsteps(-5)).toEqual([]);
    expect(movementSubsteps(Number.NaN)).toEqual([]);
    expect(movementSubsteps(Number.POSITIVE_INFINITY)).toEqual([]);
  });
});
