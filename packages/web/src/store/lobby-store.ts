import { create } from "zustand";

/**
 * Store Zustand del lobby multijugador (ticket 0.5).
 *
 * Es el puente entre la conexión Colyseus, la escena Phaser y el HUD React:
 * la conexión escribe el estado autoritativo que llega del servidor, la escena
 * lo lee para interpolar los avatares y el HUD lo pinta.
 */

export interface LobbyPlayer {
  id: string;
  x: number;
  y: number;
  tint: string;
}

export type LobbyStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export interface LobbyState {
  status: LobbyStatus;
  selfId: string | null;
  players: Record<string, LobbyPlayer>;
  /** Último rechazo de movimiento del servidor (p. ej. `MOVE_TOO_FAST`). */
  error: string | null;
  /** Error de conexión (fallo al conectar con el servidor Colyseus). */
  connectionError: string | null;
  setStatus: (status: LobbyStatus) => void;
  setSelfId: (id: string | null) => void;
  setPlayers: (players: Record<string, LobbyPlayer>) => void;
  setError: (error: string | null) => void;
  setConnectionError: (error: string | null) => void;
  reset: () => void;
}

const INITIAL = {
  status: "idle" as LobbyStatus,
  selfId: null,
  players: {} as Record<string, LobbyPlayer>,
  error: null,
  connectionError: null,
};

export const useLobbyStore = create<LobbyState>((set) => ({
  ...INITIAL,
  setStatus: (status) => set({ status }),
  setSelfId: (selfId) => set({ selfId }),
  setPlayers: (players) => set({ players }),
  setError: (error) => set({ error }),
  setConnectionError: (connectionError) => set({ connectionError }),
  reset: () => set({ ...INITIAL, players: {} }),
}));
