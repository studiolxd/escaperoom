import { create } from "zustand";
import { canConnectMedia, type MediaTokenPayload } from "@/lib/media";

/**
 * Estado de medios del lobby (ticket 2.2): puente entre la conexión Colyseus
 * (que recibe `media_token`) y el overlay de tiles LiveKit. La escena Phaser no
 * lo usa; es exclusivamente React.
 */

export type MediaStatus =
  "idle" | "connecting" | "connected" | "disconnected" | "error" | "unavailable";

export interface MediaState {
  status: MediaStatus;
  payload: MediaTokenPayload | null;
  error: string | null;
  /** Se incrementa al pedir "Reintentar": remonta el `LiveKitRoom`. */
  attempt: number;
  setPayload: (payload: MediaTokenPayload | null) => void;
  setStatus: (status: MediaStatus) => void;
  setError: (error: string | null) => void;
  retry: () => void;
  reset: () => void;
}

const INITIAL = {
  status: "idle" as MediaStatus,
  payload: null as MediaTokenPayload | null,
  error: null as string | null,
  attempt: 0,
};

export const useMediaStore = create<MediaState>((set) => ({
  ...INITIAL,
  setPayload: (payload) => {
    const status: MediaStatus = canConnectMedia(payload)
      ? "connecting"
      : payload
        ? "unavailable"
        : "idle";
    set({ payload, status, error: null });
  },
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error, status: error ? "error" : "idle" }),
  retry: () => set((state) => ({ attempt: state.attempt + 1, error: null, status: "connecting" })),
  reset: () => set({ ...INITIAL }),
}));
