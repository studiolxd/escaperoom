/**
 * Capa de red de la página del playtest (ticket 3.8): tipado mínimo del estado
 * de la `GameRoom` que llega por Colyseus y su conversión a una vista plana
 * para React. Se declara aquí (como `lobby-net`) para no arrastrar el schema
 * del servidor al bundle del navegador.
 */

/** Room de Colyseus del playtest (`PLAYTEST_ROOM_NAME` en `@escaperoom/colyseus-server`). */
export const PLAYTEST_ROOM_NAME = "playtest" as const;

/** Cierre por caducidad (`PLAYTEST_EXPIRED_CLOSE_CODE` en el servidor). */
export const PLAYTEST_EXPIRED_CLOSE_CODE = 4410;

/** Mensajes del protocolo de partida que usa esta página (specs/11 §4–6). */
export const PLAYTEST_MESSAGES = {
  startGame: "start_game",
  interact: "interact",
  dialogShow: "dialog_show",
  objectStateChanged: "object_state_changed",
  itemGranted: "item_granted",
  puzzleSolved: "puzzle_solved",
  gameEnded: "game_ended",
  error: "error",
} as const;

interface MapLike<T> {
  forEach: (callback: (value: T, key: string) => void) => void;
}

export interface PlaytestStateLike {
  phase: string;
  result: string;
  roomPackageId: string;
  hostId: string;
  endsAt: number;
  players: MapLike<{ id: string; name: string; roomId: string; tint: string; connected: boolean }>;
  objects: MapLike<string>;
  inventories: MapLike<{ items: { forEach: (callback: (item: string) => void) => void } }>;
}

export interface PlaytestPlayerView {
  id: string;
  name: string;
  roomId: string;
  tint: string;
  connected: boolean;
  isHost: boolean;
}

export interface PlaytestView {
  phase: string;
  result: string;
  roomPackageId: string;
  endsAt: number;
  players: PlaytestPlayerView[];
  objects: Array<{ id: string; state: string }>;
  inventory: string[];
}

/** Proyección plana del estado para el jugador `selfId`. */
export function toPlaytestView(state: PlaytestStateLike, selfId: string): PlaytestView {
  const players: PlaytestPlayerView[] = [];
  state.players.forEach((player) =>
    players.push({
      id: player.id,
      name: player.name,
      roomId: player.roomId,
      tint: player.tint,
      connected: player.connected,
      isHost: player.id === state.hostId,
    }),
  );
  const objects: Array<{ id: string; state: string }> = [];
  state.objects.forEach((value, id) => objects.push({ id, state: value }));
  objects.sort((a, b) => a.id.localeCompare(b.id));
  const inventory: string[] = [];
  state.inventories.forEach((entry, playerId) => {
    if (playerId === selfId) entry.items.forEach((item) => inventory.push(item));
  });
  return {
    phase: state.phase,
    result: state.result,
    roomPackageId: state.roomPackageId,
    endsAt: state.endsAt,
    players,
    objects,
    inventory,
  };
}
