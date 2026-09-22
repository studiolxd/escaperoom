import { create } from "zustand";

/**
 * Store Zustand compartido del estado de partida.
 *
 * Es el puente entre la capa Phaser (canvas) y la capa React (overlay HUD):
 * ambas leen y escriben el mismo estado y reaccionan a sus cambios
 * (specs/03 §3, ADR-019). Aquí vive un subconjunto mínimo del estado que
 * ambos lados necesitan para el tilemap de prueba del ticket 0.4.
 */

export const TORCH_MIN = 0;
export const TORCH_MAX = 100;

export interface IsoTile {
  x: number;
  y: number;
}

export interface GameState {
  /** Luz de la antorcha del jugador (0–100). El HUD la muestra y Phaser la usa como nivel de luz. */
  torchLevel: number;
  /** Última casilla isométrica seleccionada; Phaser la fija al hacer clic y el HUD la pinta. */
  tile: IsoTile;
  setTorchLevel: (level: number) => void;
  addTorch: (delta: number) => void;
  setTile: (x: number, y: number) => void;
  reset: () => void;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const INITIAL_STATE = {
  torchLevel: 60,
  tile: { x: 0, y: 0 } satisfies IsoTile,
} as const;

export const useGameStore = create<GameState>((set) => ({
  torchLevel: INITIAL_STATE.torchLevel,
  tile: { ...INITIAL_STATE.tile },
  setTorchLevel: (level) => set({ torchLevel: clamp(level, TORCH_MIN, TORCH_MAX) }),
  addTorch: (delta) =>
    set((state) => ({ torchLevel: clamp(state.torchLevel + delta, TORCH_MIN, TORCH_MAX) })),
  setTile: (x, y) => set({ tile: { x, y } }),
  reset: () => set({ torchLevel: INITIAL_STATE.torchLevel, tile: { ...INITIAL_STATE.tile } }),
}));
