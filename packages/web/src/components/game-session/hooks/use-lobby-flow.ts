import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GameClient,
  GamePlayerSnapshot,
  GameSnapshot,
} from "@escaperoom/game-runtime/session";

/**
 * Etapa de la experiencia de entrada de ESTE jugador (encargo lobby-diseño,
 * specs/11 §4.1; sin 3-2-1, encargo limpieza-entrada):
 *
 * - `lobby`: sala de espera (fase `lobby`), antes de «Empezar».
 * - `intro`: ya se pulsó «Empezar» (o llegó tarde a una partida en curso) y
 *   la sala tiene introducción que aún no ha cerrado.
 * - `entering`: introducción cerrada (o sin ella): ya se mandó `enter_map` y
 *   se espera la confirmación del servidor, con el mismo fundido de fondo que
 *   la introducción — sin número ni cuenta atrás.
 * - `map`: ya está en el mapa (también quien reconecta a mitad de partida:
 *   el servidor conserva `inMap` y se salta lobby e introducción), la partida
 *   terminó, o no es un jugador (observador).
 */
export type LobbyStage = "lobby" | "intro" | "entering" | "map";

export function lobbyStageOf(
  phase: GameSnapshot["phase"],
  self: GamePlayerSnapshot | null,
  hasIntro: boolean,
  introClosed: boolean,
): LobbyStage {
  if (phase === "lobby") return "lobby";
  if (!self || self.inMap || phase === "ended") return "map";
  if (hasIntro && !introClosed) return "intro";
  return "entering";
}

export interface UseLobbyFlowOptions {
  snapshot: GameSnapshot;
  client: Pick<GameClient, "enterMap">;
  /** La sala tiene introducción que mostrar (texto o vídeo). */
  hasIntro: boolean;
}

/**
 * Máquina de estados de la entrada al mapa: introducción (cada jugador la
 * cierra cuando quiere, sin límite de tiempo, y no se puede volver a ver) y
 * `enter_map`, inmediato al cerrarla (o al pulsar «Empezar» si no hay
 * introducción) — sin cuenta atrás de por medio (encargo limpieza-entrada):
 * el fundido se queda en pantalla exactamente hasta que el servidor confirma
 * `inMap`, ni un instante de más ni de menos. El reloj de la partida lo
 * arranca el servidor cuando el PRIMERO entra al mapa: aquí no se mide nada.
 */
export function useLobbyFlow({ snapshot, client, hasIntro }: UseLobbyFlowOptions) {
  const [introClosed, setIntroClosed] = useState(false);
  const sentRef = useRef(false);

  const stage = lobbyStageOf(snapshot.phase, snapshot.self, hasIntro, introClosed);

  useEffect(() => {
    if (stage !== "entering" || sentRef.current) return;
    sentRef.current = true;
    client.enterMap();
  }, [stage, client]);

  const closeIntro = useCallback(() => setIntroClosed(true), []);

  return { stage, closeIntro };
}
