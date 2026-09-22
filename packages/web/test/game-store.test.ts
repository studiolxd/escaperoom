import { beforeEach, describe, expect, it } from "vitest";
import { TORCH_MAX, TORCH_MIN, useGameStore } from "../src/store/game-store";

describe("useGameStore", () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it("arranca con un nivel de antorcha por defecto dentro de rango", () => {
    const { torchLevel } = useGameStore.getState();
    expect(torchLevel).toBeGreaterThanOrEqual(TORCH_MIN);
    expect(torchLevel).toBeLessThanOrEqual(TORCH_MAX);
  });

  it("addTorch acumula el delta", () => {
    useGameStore.getState().addTorch(10);
    useGameStore.getState().addTorch(5);
    expect(useGameStore.getState().torchLevel).toBe(75);
  });

  it("addTorch recorta por arriba al máximo", () => {
    useGameStore.getState().addTorch(10_000);
    expect(useGameStore.getState().torchLevel).toBe(TORCH_MAX);
  });

  it("addTorch recorta por abajo al mínimo", () => {
    useGameStore.getState().addTorch(-10_000);
    expect(useGameStore.getState().torchLevel).toBe(TORCH_MIN);
  });

  it("setTorchLevel recorta valores fuera de rango", () => {
    useGameStore.getState().setTorchLevel(-50);
    expect(useGameStore.getState().torchLevel).toBe(TORCH_MIN);
    useGameStore.getState().setTorchLevel(150);
    expect(useGameStore.getState().torchLevel).toBe(TORCH_MAX);
  });

  it("setTile guarda la casilla seleccionada", () => {
    useGameStore.getState().setTile(3, 7);
    expect(useGameStore.getState().tile).toEqual({ x: 3, y: 7 });
  });

  it("reset restaura el estado inicial", () => {
    useGameStore.getState().addTorch(1000);
    useGameStore.getState().setTile(9, 9);
    useGameStore.getState().reset();
    const state = useGameStore.getState();
    expect(state.torchLevel).toBe(60);
    expect(state.tile).toEqual({ x: 0, y: 0 });
  });
});
