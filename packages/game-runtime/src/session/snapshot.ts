import type { GameChatEntry, GamePlayerSnapshot, GamePuzzleSnapshot, GameSnapshot } from "./types";

/**
 * Tipado estructural mínimo del `GameRoomState` que sincroniza Colyseus
 * (`MapSchema`/`ArraySchema` exponen `forEach`). Se declara aquí para no
 * arrastrar el schema del servidor al bundle del navegador.
 */
interface Each<T> {
  forEach: (callback: (value: T, key: string) => void) => void;
}

export interface GameRoomStateLike {
  phase: string;
  result: string;
  roomPackageId: string;
  roomPackageVersion: string;
  startedAt: number;
  endsAt: number;
  clock: number;
  hostId: string;
  players: Each<{
    id: string;
    name: string;
    x: number;
    y: number;
    roomId: string;
    tint: string;
    characterId: string;
    connected: boolean;
  }>;
  objects: Each<string>;
  puzzles: Each<{ state: string; attempts: number; solvedBy: string }>;
  inventories: Each<{ items: { forEach: (callback: (item: string) => void) => void } }>;
  flags: Each<string>;
  /** Ventana de chat; las rooms anteriores a 2.1 en partida no la traían. */
  chat?: { forEach: (callback: (message: GameChatEntry) => void) => void };
}

/** Instantánea vacía mientras no ha llegado el primer estado. */
export function emptyGameSnapshot(selfId = ""): GameSnapshot {
  return {
    selfId,
    phase: "lobby",
    result: "",
    roomPackageId: "",
    roomPackageVersion: "",
    hostId: "",
    clock: 0,
    startedAt: 0,
    endsAt: 0,
    players: [],
    self: null,
    objects: {},
    puzzles: {},
    inventory: [],
    inventories: {},
    flags: {},
    chat: [],
  };
}

/**
 * Convierte el room state sincronizado en la instantánea plana que consumen
 * Phaser y React. Las flags viajan serializadas en JSON (`"3"`, `true`…).
 */
export function toGameSnapshot(state: GameRoomStateLike | undefined, selfId: string): GameSnapshot {
  if (!state) return emptyGameSnapshot(selfId);

  const players: GamePlayerSnapshot[] = [];
  state.players?.forEach((player) => {
    players.push({
      id: player.id,
      name: player.name,
      x: player.x,
      y: player.y,
      roomId: player.roomId,
      tint: player.tint,
      characterId: player.characterId,
      connected: player.connected,
      isHost: player.id === state.hostId,
      isSelf: player.id === selfId,
    });
  });

  const objects: Record<string, string> = {};
  state.objects?.forEach((value, id) => {
    objects[id] = value;
  });

  const puzzles: Record<string, GamePuzzleSnapshot> = {};
  state.puzzles?.forEach((puzzle, id) => {
    puzzles[id] = { state: puzzle.state, attempts: puzzle.attempts, solvedBy: puzzle.solvedBy };
  });

  const inventories: Record<string, string[]> = {};
  state.inventories?.forEach((entry, playerId) => {
    const items: string[] = [];
    entry.items.forEach((item) => items.push(item));
    inventories[playerId] = items;
  });

  const flags: Record<string, string | number | boolean> = {};
  state.flags?.forEach((encoded, name) => {
    flags[name] = decodeFlag(encoded);
  });

  const chat: GameChatEntry[] = [];
  state.chat?.forEach((message) => {
    chat.push({
      id: message.id,
      authorId: message.authorId,
      authorName: message.authorName,
      text: message.text,
      ts: message.ts,
      filtered: message.filtered,
    });
  });

  return {
    selfId,
    phase: state.phase,
    result: state.result,
    roomPackageId: state.roomPackageId,
    roomPackageVersion: state.roomPackageVersion,
    hostId: state.hostId,
    clock: state.clock,
    startedAt: state.startedAt,
    endsAt: state.endsAt,
    players,
    self: players.find((player) => player.isSelf) ?? null,
    objects,
    puzzles,
    inventory: inventories[selfId] ?? [],
    inventories,
    flags,
    chat,
  };
}

function decodeFlag(encoded: string): string | number | boolean {
  try {
    const value = JSON.parse(encoded) as unknown;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
  } catch {
    // Flag sin JSON válido: se conserva tal cual.
  }
  return encoded;
}

/** Tiempo restante en ms (reloj lógico del servidor); `null` si no hay límite. */
export function remainingMs(snapshot: GameSnapshot): number | null {
  if (!snapshot.endsAt) return null;
  return Math.max(0, snapshot.endsAt - snapshot.clock);
}
