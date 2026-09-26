import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GameClient,
  GamePlayerSnapshot,
  GameSnapshot,
} from "@escaperoom/game-runtime/session";
import { LOBBY_COUNTDOWN_SECONDS } from "@escaperoom/shared/schemas";

/**
 * Etapa de la experiencia de entrada de ESTE jugador (encargo lobby-diseño,
 * specs/11 §4.1):
 *
 * - `lobby`: sala de espera (fase `lobby`), antes de «Empezar».
 * - `intro`: ya se pulsó «Empezar» (o llegó tarde a una partida en curso) y
 *   la sala tiene introducción que aún no ha cerrado.
 * - `countdown`: su 3-2-1 (3 s, sin botón de saltar); al terminar manda
 *   `enter_map`.
 * - `map`: ya está en el mapa (también quien reconecta a mitad de partida:
 *   el servidor conserva `inMap` y se salta lobby e introducción), la partida
 *   terminó, o no es un jugador (observador).
 */
export type LobbyStage = "lobby" | "intro" | "countdown" | "map";

export function lobbyStageOf(
  phase: GameSnapshot["phase"],
  self: GamePlayerSnapshot | null,
  hasIntro: boolean,
  introClosed: boolean,
): LobbyStage {
  if (phase === "lobby") return "lobby";
  if (!self || self.inMap || phase === "ended") return "map";
  if (hasIntro && !introClosed) return "intro";
  return "countdown";
}

export interface UseLobbyFlowOptions {
  snapshot: GameSnapshot;
  client: Pick<GameClient, "enterMap">;
  /** La sala tiene introducción que mostrar (texto o vídeo). */
  hasIntro: boolean;
}

/**
 * Máquina de estados de la entrada al mapa: introducción (cada jugador la
 * cierra cuando quiere, sin límite de tiempo, y no se puede volver a ver),
 * 3-2-1 propio y `enter_map`. El reloj de la partida lo arranca el servidor
 * cuando el PRIMERO entra al mapa: aquí no se mide nada.
 */
export function useLobbyFlow({ snapshot, client, hasIntro }: UseLobbyFlowOptions) {
  const [introClosed, setIntroClosed] = useState(false);
  const [countdown, setCountdown] = useState(LOBBY_COUNTDOWN_SECONDS);
  const sentRef = useRef(false);

  const stage = lobbyStageOf(snapshot.phase, snapshot.self, hasIntro, introClosed);

  useEffect(() => {
    if (stage !== "countdown") return;
    setCountdown(LOBBY_COUNTDOWN_SECONDS);
    let left = LOBBY_COUNTDOWN_SECONDS;
    const timer = window.setInterval(() => {
      left -= 1;
      setCountdown(Math.max(0, left));
      if (left <= 0) {
        window.clearInterval(timer);
        if (!sentRef.current) {
          sentRef.current = true;
          client.enterMap();
        }
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage, client]);

  const closeIntro = useCallback(() => setIntroClosed(true), []);

  return { stage, countdown, closeIntro };
}
