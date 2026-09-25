import type { RoomPuzzlePublicView, SessionStats } from "@escaperoom/shared/session";

/**
 * Fuente de estado de una partida, **intercambiable** entre red y local
 * (specs/03 §3, specs/11): la UI (Phaser + paneles React) solo consume un
 * `GameSnapshot` —la proyección pública que sincroniza la `GameRoom`— y los
 * `GameEvent` dirigidos o difundidos, y expresa intenciones con `GameActions`.
 * Nunca recibe ni calcula soluciones: cada panel pinta la vista pública que le
 * manda el servidor (`puzzle_view`) y el desenlace de su intento
 * (`attempt_result`).
 *
 * - Red (`createNetworkGameClient`): la room de Colyseus es la fuente de verdad.
 * - Local (`createLocalGameClient`): emula la `GameRoom` en proceso sobre
 *   `RoomSession`, para el playtest sin servidor y los tests.
 */

export type GamePhase = "lobby" | "playing" | "paused" | "ended" | (string & {});

export interface GamePlayerSnapshot {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Habitación (subroom) actual. */
  roomId: string;
  /** Color de tintado `#rrggbb` asignado por el servidor. */
  tint: string;
  /** Personaje jugable (`manifest.avatars[].id`, o el de reserva, A1/B4). */
  characterId: string;
  connected: boolean;
  isHost: boolean;
  isSelf: boolean;
}

export interface GamePuzzleSnapshot {
  state: string;
  attempts: number;
  solvedBy: string;
}

export interface GameChatEntry {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  ts: number;
  filtered: boolean;
}

/** Proyección pública del room state para el jugador `selfId`. */
export interface GameSnapshot {
  selfId: string;
  phase: GamePhase;
  /** `victory | timeout | abandoned`, o `""` mientras se juega. */
  result: string;
  roomPackageId: string;
  roomPackageVersion: string;
  hostId: string;
  /** Reloj lógico de la sala (ms). */
  clock: number;
  startedAt: number;
  /** `0` = sin límite. */
  endsAt: number;
  players: GamePlayerSnapshot[];
  /** El jugador local, si ya está en el estado. */
  self: GamePlayerSnapshot | null;
  objects: Record<string, string>;
  puzzles: Record<string, GamePuzzleSnapshot>;
  /** Inventario del jugador local. */
  inventory: string[];
  inventories: Record<string, string[]>;
  flags: Record<string, string | number | boolean>;
  chat: GameChatEntry[];
}

/** Stats del fin de partida (`game_ended`, specs/11 §6). */
export type GameEndStats = SessionStats;

/** Mensajes servidor → cliente (specs/11 §5–6, §8), ya tipados. */
export type GameEvent =
  | { type: "dialog_show"; dialogId: string }
  | { type: "object_state_changed"; objectId: string; state: string }
  | { type: "item_granted"; playerId: string; itemId: string }
  | {
      type: "puzzle_solved";
      puzzleId: string;
      solvedBy: string | null;
      grantsItems: string[];
      unlocks: string[];
    }
  | { type: "game_ended"; result: string; stats: GameEndStats | null }
  | { type: "puzzle_view"; puzzleId: string; view: RoomPuzzlePublicView }
  | {
      type: "attempt_result";
      puzzleId: string;
      ok: boolean;
      outcome: string;
      error?: string;
      retryAfterSec?: number;
      revealedSymbol?: string;
      output?: string;
    }
  | {
      type: "split_fragments";
      puzzleId: string;
      viewpointId: string | null;
      fragments: Record<string, string>;
    }
  | { type: "hint_delivered"; puzzleId: string; tier: number | null; text: string | null }
  | {
      type: "error";
      code: string;
      message: string;
      retryAfterMs?: number;
      /** Mensaje rechazado por el rate limit del servidor (`RATE_LIMITED`, specs/11 §9). */
      messageType?: string;
    }
  | { type: "media_token"; payload: unknown };

export type GameEventType = GameEvent["type"];

/** Intención del jugador para un puzzle (`puzzle_attempt.attempt`, specs/11 §5). */
export type GameAttempt =
  | Record<string, never>
  | { code: string }
  | { move: number }
  | { flip: string }
  | { rotate: number; turns?: number }
  | { gate: number }
  | { symbols: string[] };

/** Comandos cliente → servidor (specs/11 §4). */
export interface GameActions {
  startGame(): void;
  /** Posición deseada; con `roomId` distinto al actual, cruce de habitación. */
  move(x: number, y: number, roomId?: string): void;
  interact(objectId: string): void;
  useItem(itemId: string, objectId: string): void;
  combine(inputs: readonly string[], puzzleId?: string): void;
  openPuzzle(puzzleId: string): void;
  closePuzzle(puzzleId: string): void;
  attempt(puzzleId: string, attempt: GameAttempt): void;
  setPlate(plateId: string, active: boolean, puzzleId?: string): void;
  requestSplitView(puzzleId?: string): void;
  requestHint(puzzleId: string): void;
  /** Elige/cambia de personaje (A1); el servidor valida unicidad y difunde el estado. */
  selectCharacter(characterId: string): void;
  sendChat(text: string): void;
  requestMediaToken(role?: "player" | "observer"): void;
}

export interface GameClient extends GameActions {
  /** `sessionId` del jugador local. */
  readonly selfId: string;
  /** Instantánea actual (estable entre cambios: sirve a `useSyncExternalStore`). */
  getSnapshot(): GameSnapshot;
  /** Se llama tras cada cambio del estado sincronizado. */
  subscribe(listener: (snapshot: GameSnapshot) => void): () => void;
  onEvent(listener: (event: GameEvent) => void): () => void;
  /** Sale de la partida (consentido). */
  leave(): Promise<void>;
}
