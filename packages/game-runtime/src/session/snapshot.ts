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

/** Igualdad superficial por clave (primitivos únicamente, como los snapshots de aquí). */
function shallowEqual<T extends object>(a: T, b: T): boolean {
  const ar = a as Record<string, unknown>;
  const br = b as Record<string, unknown>;
  for (const key in ar) if (ar[key] !== br[key]) return false;
  for (const key in br) if (!(key in ar)) return false;
  return true;
}

/**
 * F-4: reconstruye la lista de jugadores, pero reutiliza la referencia
 * anterior —del array y de cada jugador que no cambió— si nada varió desde
 * el último `toGameSnapshot`. Antes se creaba un array y un objeto por
 * jugador en CADA patch de Colyseus (~20 Hz), lo que invalidaba cualquier
 * `React.memo`/selector aguas abajo aunque nada relevante hubiera cambiado.
 */
function buildPlayers(
  state: GameRoomStateLike,
  selfId: string,
  previous: readonly GamePlayerSnapshot[],
): GamePlayerSnapshot[] {
  const next: GamePlayerSnapshot[] = [];
  let index = 0;
  let changed = false;
  state.players?.forEach((player) => {
    const candidate: GamePlayerSnapshot = {
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
    };
    const prevPlayer = previous[index];
    if (prevPlayer && shallowEqual(prevPlayer, candidate)) {
      next.push(prevPlayer);
    } else {
      next.push(candidate);
      changed = true;
    }
    index += 1;
  });
  if (!changed && next.length === previous.length) return previous as GamePlayerSnapshot[];
  return next;
}

/** F-4: mismo objeto que la vez anterior si ningún objeto del mundo cambió de estado. */
function buildObjects(
  state: GameRoomStateLike,
  previous: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  let count = 0;
  let changed = false;
  state.objects?.forEach((value, id) => {
    next[id] = value;
    count += 1;
    if (previous[id] !== value) changed = true;
  });
  if (!changed && count === Object.keys(previous).length) return previous;
  return next;
}

/** F-4: idem, pero reutiliza también cada `GamePuzzleSnapshot` individual sin cambios (paneles memoizables). */
function buildPuzzles(
  state: GameRoomStateLike,
  previous: Record<string, GamePuzzleSnapshot>,
): Record<string, GamePuzzleSnapshot> {
  const next: Record<string, GamePuzzleSnapshot> = {};
  let count = 0;
  let changed = false;
  state.puzzles?.forEach((puzzle, id) => {
    const candidate: GamePuzzleSnapshot = {
      state: puzzle.state,
      attempts: puzzle.attempts,
      solvedBy: puzzle.solvedBy,
    };
    const prev = previous[id];
    if (prev && shallowEqual(prev, candidate)) {
      next[id] = prev;
    } else {
      next[id] = candidate;
      changed = true;
    }
    count += 1;
  });
  if (!changed && count === Object.keys(previous).length) return previous;
  return next;
}

/** F-4: idem para el inventario de cada jugador (array reutilizado si no cambió su contenido). */
function buildInventories(
  state: GameRoomStateLike,
  previous: Record<string, string[]>,
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  let count = 0;
  let changed = false;
  state.inventories?.forEach((entry, playerId) => {
    const items: string[] = [];
    entry.items.forEach((item) => items.push(item));
    const prev = previous[playerId];
    if (prev && prev.length === items.length && prev.every((item, i) => item === items[i])) {
      next[playerId] = prev;
    } else {
      next[playerId] = items;
      changed = true;
    }
    count += 1;
  });
  if (!changed && count === Object.keys(previous).length) return previous;
  return next;
}

/** F-4: idem para las flags decodificadas. */
function buildFlags(
  state: GameRoomStateLike,
  previous: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const next: Record<string, string | number | boolean> = {};
  let count = 0;
  let changed = false;
  state.flags?.forEach((encoded, name) => {
    const value = decodeFlag(encoded);
    next[name] = value;
    count += 1;
    if (previous[name] !== value) changed = true;
  });
  if (!changed && count === Object.keys(previous).length) return previous;
  return next;
}

/** F-4: idem para la ventana de chat (misma referencia mientras no llegue/rote ningún mensaje). */
function buildChat(
  state: GameRoomStateLike,
  previous: readonly GameChatEntry[],
): GameChatEntry[] {
  const next: GameChatEntry[] = [];
  let index = 0;
  let changed = false;
  state.chat?.forEach((message) => {
    const candidate: GameChatEntry = {
      id: message.id,
      authorId: message.authorId,
      authorName: message.authorName,
      text: message.text,
      ts: message.ts,
      filtered: message.filtered,
    };
    const prev = previous[index];
    if (prev && shallowEqual(prev, candidate)) {
      next.push(prev);
    } else {
      next.push(candidate);
      changed = true;
    }
    index += 1;
  });
  if (!changed && next.length === previous.length) return previous as GameChatEntry[];
  return next;
}

/**
 * Convierte el room state sincronizado en la instantánea plana que consumen
 * Phaser y React. Las flags viajan serializadas en JSON (`"3"`, `true`…).
 *
 * F-4: `previous` (el snapshot anterior, si lo hay) permite reconstruir cada
 * colección de forma incremental — reutilizando su referencia si no cambió
 * de verdad — en vez de crear players/objects/puzzles/inventories/chat desde
 * cero en cada patch de Colyseus (~20 Hz). Un selector por slice (o
 * `React.memo`) aguas abajo puede entonces saltarse el repintado cuando la
 * parte que le importa no cambió, aunque llegue un patch por otra razón
 * (p. ej. solo se movió un jugador).
 */
export function toGameSnapshot(
  state: GameRoomStateLike | undefined,
  selfId: string,
  previous: GameSnapshot = emptyGameSnapshot(selfId),
): GameSnapshot {
  if (!state) return emptyGameSnapshot(selfId);

  const players = buildPlayers(state, selfId, previous.players);
  const objects = buildObjects(state, previous.objects);
  const puzzles = buildPuzzles(state, previous.puzzles);
  const inventories = buildInventories(state, previous.inventories);
  const flags = buildFlags(state, previous.flags);
  const chat = buildChat(state, previous.chat);
  const inventory = inventories[selfId] ?? EMPTY_INVENTORY;
  // `buildPlayers` reutiliza el objeto de cada jugador sin cambios, así que
  // esto mantiene la misma referencia para `self` mientras no cambien sus
  // propios datos, aunque la lista entera se reconstruya por otro jugador.
  const self = players.find((player) => player.isSelf) ?? null;

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
    self,
    objects,
    puzzles,
    inventory,
    inventories,
    flags,
    chat,
  };
}

const EMPTY_INVENTORY: string[] = [];

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

/**
 * Tiempo jugado en ms (ticket duración-salas, specs/04 §6): el HUD lo usa
 * como presentación mínima cuando la sala no tiene cuenta atrás
 * (`remainingMs` devuelve `null`) — nunca "00:00". `null` antes de empezar.
 *
 * "Antes de empezar" se decide por `phase` (`"lobby"`), no por si
 * `startedAt` es *truthy*: en el cliente local (`createLocalGameClient`),
 * `startedAt` es tiempo lógico relativo a la creación del cliente
 * (`session/local.ts`), así que una partida iniciada en el mismo instante en
 * que se crea el cliente (habitual en tests síncronos, y visto de forma
 * intermitente en CI) tiene legítimamente `startedAt === 0` — antes se leía
 * como "sin empezar" y el HUD no pintaba ni el cronómetro ni el tiempo
 * transcurrido.
 */
export function elapsedMs(snapshot: GameSnapshot): number | null {
  if (snapshot.phase === "lobby") return null;
  return Math.max(0, snapshot.clock - snapshot.startedAt);
}
