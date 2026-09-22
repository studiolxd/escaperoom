import type { LobbyPlayer } from "@/store/lobby-store";

/**
 * Tipado mínimo del estado autoritativo que llega por Colyseus. Se declara
 * aquí en lugar de importar el schema del servidor para no arrastrar sus
 * dependencias al bundle del navegador.
 */
export interface RemotePlayerState {
  id: string;
  x: number;
  y: number;
  tint: string;
}

export interface LobbyStateLike {
  players: {
    forEach: (callback: (player: RemotePlayerState) => void) => void;
  };
}

/** Convierte el `MapSchema` de jugadores del servidor en un registro plano. */
export function collectPlayers(state: LobbyStateLike): Record<string, LobbyPlayer> {
  const players: Record<string, LobbyPlayer> = {};
  state.players.forEach((player) => {
    players[player.id] = {
      id: player.id,
      x: player.x,
      y: player.y,
      tint: player.tint,
    };
  });
  return players;
}
