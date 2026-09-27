"use client";

import { createContext, useContext } from "react";

/**
 * Notifica a `PlayRoomShell` (`components/layout/play-room-shell.tsx`) cuando
 * `NetworkGame` pasa de las pantallas previas (unirse/conectando) a la
 * partida real (`GameSessionShell` montado), para ocultar el header/footer
 * públicos y el padding de `main` mientras se juega.
 */
export const PlayPhaseContext = createContext<(playing: boolean) => void>(() => {});

export function useSetPlayPhase(): (playing: boolean) => void {
  return useContext(PlayPhaseContext);
}
