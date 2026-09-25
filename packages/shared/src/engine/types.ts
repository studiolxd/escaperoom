import type { LocalizedText, Position, Rect } from "../schemas/common";
import type { PuzzleState } from "../schemas/puzzle";
import type { FlagValue, RuleAction, RuleTrigger } from "../schemas/rules";

/**
 * Evento que entra al motor. Reutiliza el vocabulario de `RuleTrigger` (0.6) y
 * añade el jugador que lo provocó (`playerId`), necesario para las acciones con
 * `to: 'interactor'` y para el inventario por jugador.
 */
export type GameEvent = RuleTrigger & { playerId?: string };

/** Fase de la partida (specs/04 §5). */
export type GamePhase = "lobby" | "playing" | "paused" | "ended";

/** Resultado de `end_game` (specs/05 §3). */
export type GameEndResult = "victory" | "timeout" | "abandoned";

/** Estado sincronizado de un puzzle (specs/05 §1.1). */
export interface PuzzleRuntime {
  state: PuzzleState;
  solvedBy?: string;
  solvedAt?: number;
  attempts: number;
  /** Campos específicos de plantilla (p. ej. `remaining`, `order`). */
  [key: string]: unknown;
}

/**
 * Timer lógico. El motor no usa `setTimeout`: `remainingSec` solo avanza en
 * `tick(now)`, lo que hace el comportamiento determinista y testeable.
 *
 * - `periodic` viene de que exista una regla `on_timer` escuchando ese `id`:
 *   entonces cada periodo emite `on_timer` y reinicia la cuenta.
 * - Un timer no periódico emite `on_timer_end` al agotarse.
 */
export interface TimerState {
  id: string;
  durationSec: number | null;
  remainingSec: number | null;
  running: boolean;
  periodic: boolean;
  startedAt: number;
  elapsedMs: number;
  pausedAt?: number;
  stoppedAt?: number;
}

/** Posición/estado mínimo del avatar que consultan las condiciones de zona. */
export interface PlayerRuntime {
  roomId?: string;
  position?: Position;
}

/** Acción diferida por `delay` (cola serializable, no `setTimeout`). */
export interface DeferredAction {
  id: string;
  ruleId: string;
  dueAt: number;
  actions: RuleAction[];
  event: GameEvent;
}

/** Libro de reglas: cuántas veces disparó cada una y cuándo (specs/05 §2.2). */
export interface RuleRuntimeState {
  firedAt: number;
  count: number;
  lastEventType?: string;
}

/**
 * Estado global serializable de la partida (specs/05 §1). Los `Map` de la spec
 * se representan como `Record` para que el estado viaje en JSON sin pérdida.
 * Los campos `ruleRuns`, `deferred`, `reveals` y `lastTickAt` son contabilidad
 * del motor; el resto es el estado de juego.
 */
export interface GameState {
  flags: Record<string, FlagValue>;
  puzzleStates: Record<string, PuzzleRuntime>;
  inventory: Record<string, string[]>;
  objectStates: Record<string, string>;
  timers: Record<string, TimerState>;
  hintsUsed: Record<string, number>;
  startedAt: number;
  timeLimitSec?: number;
  phase: GamePhase;
  result?: GameEndResult;
  endedAt?: number;
  players: Record<string, PlayerRuntime>;
  ruleRuns: Record<string, RuleRuntimeState>;
  reveals: Record<string, number>;
  deferred: DeferredAction[];
  lastTickAt: number;
}

/**
 * Efecto observable que el motor no puede ejecutar por sí mismo (es puro): el
 * host (Colyseus, Phaser, React) los consume para mostrar diálogos, sonido,
 * abrir paneles, etc. Las mutaciones de estado también se emiten aquí para que
 * el host pueda sincronizarlas sin hacer diff.
 */
export type EngineEffect =
  | { type: "show_dialog"; dialogId: string }
  | { type: "show_image"; image: string; caption?: LocalizedText }
  | { type: "play_sound"; soundId: string }
  | { type: "spawn_effect"; effectId: string; position?: Position }
  | { type: "open_panel_puzzle"; puzzleId: string }
  | { type: "unlock_door"; objectId: string }
  | { type: "reveal_number"; objectId: string; value: number }
  | { type: "end_game"; result: GameEndResult }
  | { type: "grant_item"; itemId: string; playerId: string }
  | { type: "consume_item"; itemId: string; playerId: string }
  | { type: "start_timer"; id: string; durationSec?: number }
  | { type: "pause_timer"; id: string }
  | { type: "stop_timer"; id: string }
  | { type: "set_object_state"; objectId: string; state: string }
  | { type: "set_flag"; flag: string; value: FlagValue };

/** Regla disparada con éxito. */
export interface FiredRule {
  ruleId: string;
  at: number;
  event: GameEvent;
  effectCount: number;
}

/** Regla que abortó entera (transaccionalidad, specs/05 §2.1). */
export interface AbortedRule {
  ruleId: string;
  at: number;
  event: GameEvent;
  error: string;
}

/** Resultado de `dispatch`/`tick`. */
export interface EngineResult {
  now: number;
  fired: FiredRule[];
  aborted: AbortedRule[];
  effects: EngineEffect[];
  /** Eventos internos encadenados (p. ej. `grant_item` → `on_item_collected`). */
  events: GameEvent[];
  depthExceeded: boolean;
}

/** Destino de `grant_item` (specs/05 §3). */
export type GrantTarget = "interactor" | "all" | string;

export interface EngineOptions {
  /** Reloj lógico inicial del motor. */
  now?: number;
  /** Jugador por defecto cuando un evento no trae `playerId`. */
  playerId?: string;
  /** Jugadores presentes en la partida (se siembran en el estado). */
  players?: string[];
  /** Profundidad máxima de encadenamiento (specs/05 §2.1: 32). */
  maxChainDepth?: number;
}

export interface InitialStateOptions {
  playerIds?: string[];
  timeLimitSec?: number;
  now?: number;
  phase?: GamePhase;
}

/** Zona de `on_all_players_in_zone`: nombre de habitación o rectángulo. */
export type Zone = string | Rect;

/**
 * API pública del motor de reglas. `state` es el estado vivo (mutable por el
 * motor); usa `snapshot()` para una copia serializable.
 */
export interface Engine {
  readonly state: GameState;
  dispatch(event: GameEvent, now?: number): EngineResult;
  tick(now: number): EngineResult;
  grantItem(itemId: string, to?: GrantTarget, now?: number): EngineResult;
  snapshot(): GameState;
  firedCount(ruleId: string): number;
}
