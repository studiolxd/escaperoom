import type { ChatEntry, LobbyPlayer } from "@/store/lobby-store";

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

/** Mensaje de chat tal y como llega en `state.chat` (specs/11 §3–4.4). */
export interface RemoteChatMessage {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  ts: number;
  filtered: boolean;
}

export interface LobbyStateLike {
  players: {
    forEach: (callback: (player: RemotePlayerState) => void) => void;
  };
  chat?: {
    forEach: (callback: (message: RemoteChatMessage) => void) => void;
  };
}

/** Convierte el `MapSchema` de jugadores del servidor en un registro plano. */
export function collectPlayers(state: LobbyStateLike | undefined): Record<string, LobbyPlayer> {
  const players: Record<string, LobbyPlayer> = {};
  if (!state?.players) {
    return players;
  }
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

/**
 * Copia la ventana móvil de chat del `ArraySchema` a un array plano, en orden
 * de llegada (el más reciente al final).
 */
export function collectChat(state: LobbyStateLike | undefined): ChatEntry[] {
  const messages: ChatEntry[] = [];
  if (!state?.chat) {
    return messages;
  }
  state.chat.forEach((message) => {
    messages.push({
      id: message.id,
      authorId: message.authorId,
      authorName: message.authorName,
      text: message.text,
      ts: message.ts,
      filtered: message.filtered,
    });
  });
  return messages;
}
