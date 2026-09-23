import { create } from "zustand";

/**
 * Store Zustand del lobby multijugador (ticket 0.5) y su chat (ticket 2.1).
 *
 * Es el puente entre la conexión Colyseus, la escena Phaser y el HUD React:
 * la conexión escribe el estado autoritativo que llega del servidor, la escena
 * lo lee para interpolar los avatares y el HUD lo pinta. El chat reutiliza la
 * misma room: `state.chat` trae la ventana de los últimos 50 mensajes.
 */

export interface LobbyPlayer {
  id: string;
  x: number;
  y: number;
  tint: string;
}

/** Mensaje de chat ya sincronizado desde el servidor. */
export interface ChatEntry {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  ts: number;
  filtered: boolean;
}

export type LobbyStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export interface LobbyState {
  status: LobbyStatus;
  selfId: string | null;
  players: Record<string, LobbyPlayer>;
  /** Ventana móvil de chat (máx. 50, la recorta el servidor). */
  chat: ChatEntry[];
  /** Último rechazo de movimiento del servidor (p. ej. `MOVE_TOO_FAST`). */
  error: string | null;
  /** Error de conexión (fallo al conectar con el servidor Colyseus). */
  connectionError: string | null;
  /** Último rechazo del chat (p. ej. rate limit). */
  chatError: string | null;
  /** Envía un mensaje por la room; `null` mientras no hay conexión. */
  sendChat: ((text: string) => void) | null;
  setStatus: (status: LobbyStatus) => void;
  setSelfId: (id: string | null) => void;
  setPlayers: (players: Record<string, LobbyPlayer>) => void;
  setChat: (chat: ChatEntry[]) => void;
  setError: (error: string | null) => void;
  setConnectionError: (error: string | null) => void;
  setChatError: (error: string | null) => void;
  setSendChat: (sendChat: ((text: string) => void) | null) => void;
  reset: () => void;
}

const INITIAL = {
  status: "idle" as LobbyStatus,
  selfId: null,
  players: {} as Record<string, LobbyPlayer>,
  chat: [] as ChatEntry[],
  error: null,
  connectionError: null,
  chatError: null,
  sendChat: null as ((text: string) => void) | null,
};

export const useLobbyStore = create<LobbyState>((set) => ({
  ...INITIAL,
  setStatus: (status) => set({ status }),
  setSelfId: (selfId) => set({ selfId }),
  setPlayers: (players) => set({ players }),
  setChat: (chat) => set({ chat }),
  setError: (error) => set({ error }),
  setConnectionError: (connectionError) => set({ connectionError }),
  setChatError: (chatError) => set({ chatError }),
  setSendChat: (sendChat) => set({ sendChat }),
  reset: () => set({ ...INITIAL, players: {}, chat: [], sendChat: null }),
}));
