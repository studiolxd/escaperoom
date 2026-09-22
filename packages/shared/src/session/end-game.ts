import type { GameEndResult, GameState, TimerState } from "../engine";

/**
 * Fin de partida (specs/04 §6) — lógica **pura** que consume el motor de reglas
 * (ticket 1.4) y no lo duplica.
 *
 * El motor ya resuelve la condición de victoria/derrota con reglas declarativas
 * (`on_puzzle_solved` + `end_game result=victory`, `on_timer_end` +
 * `end_game result=timeout`) y deja el resultado en `GameState.result`. Esta
 * capa añade lo que el motor no proyecta:
 *
 * - normaliza el vocabulario del motor (`abandoned`) al de la partida
 *   (`aborted`);
 * - detecta el `timeout` aunque ninguna regla lo haya cerrado, cuando el
 *   cronómetro llega a 0;
 * - calcula las **stats finales** (tiempo, pistas usadas, puzzles resueltos,
 *   ítems recogidos) para la pantalla de resultados.
 *
 * Todo se deriva de un `GameState` (o de su `snapshot()`), de modo que corre en
 * el servidor y en los tests sin red, base de datos ni `setTimeout`.
 */

/** Resultado canónico de una partida (specs/04 §5–§6, ticket 1.9). */
export type SessionResult = "victory" | "timeout" | "aborted";

/** Stats finales que pinta la pantalla de resultados (specs/04 §6). */
export interface SessionStats {
  /** Tiempo total jugado, en segundos. */
  durationSec: number;
  /** Pistas consumidas del contador global. */
  hintsUsed: number;
  /** Puzzles en estado `solved`. */
  puzzlesSolved: number;
  /** Puzzles definidos por la sala. */
  puzzlesTotal: number;
  /** Ítems distintos recogidos entre todos los inventarios. */
  itemsCollected: number;
}

/**
 * Proyección pública del fin de partida: es lo único que `web` necesita para
 * montar la pantalla de resultados. No incluye código de puzzles ni estado
 * interno del motor.
 */
export interface SessionSummary {
  result: SessionResult;
  /** Reloj lógico en el que terminó la partida. */
  endedAt: number;
  stats: SessionStats;
  /** Ids de los puzzles resueltos, en orden de definición. */
  solvedPuzzles: string[];
  /** Ítems distintos recogidos, en orden de aparición. */
  items: string[];
}

export interface SessionSummaryOptions {
  /** Reloj lógico a usar si la partida aún no tiene `endedAt`. */
  now?: number;
  /** Id del timer del cronómetro (specs/04 §6); por defecto `cronometro`. */
  timerId?: string;
  /** Total de puzzles de la sala; por defecto, los presentes en el estado. */
  puzzlesTotal?: number;
  /**
   * Pistas usadas del sistema de pistas (ticket 1.8). Si no se indica, se
   * suman las de `GameState.hintsUsed`.
   */
  hintsUsed?: number;
  /** Ítems extra a considerar además de los inventarios. */
  items?: readonly string[];
}

/** Timer del cronómetro por defecto de una sala (specs/04 §6). */
export const DEFAULT_SESSION_TIMER_ID = "cronometro";

/** Traduce el resultado del motor al de la partida. */
export function toSessionResult(result: GameEndResult | undefined): SessionResult | undefined {
  if (result === "abandoned") return "aborted";
  return result;
}

/** Traduce el resultado de la partida al vocabulario del motor. */
export function toEngineResult(result: SessionResult): GameEndResult {
  return result === "aborted" ? "abandoned" : result;
}

/** Timer lógico de un estado, o `undefined` si no existe. */
export function getSessionTimer(
  state: GameState,
  timerId: string = DEFAULT_SESSION_TIMER_ID,
): TimerState | undefined {
  return state.timers[timerId];
}

/**
 * `true` si el cronómetro existe, no está corriendo y ya llegó a 0. Es la señal
 * de `timeout` independiente de que una regla lo haya cerrado.
 */
export function isTimerExpired(
  state: GameState,
  timerId: string = DEFAULT_SESSION_TIMER_ID,
): boolean {
  const timer = state.timers[timerId];
  if (!timer || timer.durationSec === null || timer.remainingSec === null) return false;
  return !timer.running && timer.remainingSec <= 0;
}

/** Segundos jugados hasta `endedAt` (o hasta `now` si sigue en curso). */
export function elapsedSeconds(state: GameState, now: number = state.lastTickAt): number {
  const end = state.endedAt ?? now;
  return Math.max(0, (end - state.startedAt) / 1000);
}

/** Ids de los puzzles resueltos, en orden de inserción del estado. */
export function solvedPuzzleIds(state: GameState): string[] {
  return Object.entries(state.puzzleStates)
    .filter(([, runtime]) => runtime.state === "solved")
    .map(([puzzleId]) => puzzleId);
}

/** Ítems distintos recogidos entre todos los inventarios (más los extra). */
export function collectedItems(state: GameState, extra: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const inventory of Object.values(state.inventory)) {
    for (const itemId of inventory) {
      if (seen.has(itemId)) continue;
      seen.add(itemId);
      items.push(itemId);
    }
  }
  for (const itemId of extra) {
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    items.push(itemId);
  }
  return items;
}

/**
 * Combina cronómetro + condición de victoria/derrota:
 *
 * 1. el resultado que ya fijó el motor (`victory`/`timeout`/abandono);
 * 2. un cierre externo sin resultado → `aborted` (specs/04 §5);
 * 3. cronómetro a 0 (o `timeLimitSec` agotado) sin regla → `timeout`;
 * 4. si no, `undefined` (la partida sigue).
 */
export function resolveSessionResult(
  state: GameState,
  options: SessionSummaryOptions = {},
): SessionResult | undefined {
  const fromEngine = toSessionResult(state.result);
  if (fromEngine) return fromEngine;
  if (state.phase === "ended") return "aborted";

  const started = state.flags.game_started === true;
  if (!started) return undefined;

  if (isTimerExpired(state, options.timerId)) return "timeout";

  const now = options.now ?? state.lastTickAt;
  if (state.timeLimitSec !== undefined && elapsedSeconds(state, now) >= state.timeLimitSec) {
    return "timeout";
  }
  return undefined;
}

/** Stats finales derivadas del estado (specs/04 §6). */
export function computeSessionStats(
  state: GameState,
  options: SessionSummaryOptions = {},
): SessionStats {
  const now = options.now ?? state.endedAt ?? state.lastTickAt;
  const hintsUsed =
    options.hintsUsed ?? Object.values(state.hintsUsed).reduce((sum, cost) => sum + cost, 0);

  return {
    durationSec: elapsedSeconds(state, now),
    hintsUsed,
    puzzlesSolved: solvedPuzzleIds(state).length,
    puzzlesTotal: options.puzzlesTotal ?? Object.keys(state.puzzleStates).length,
    itemsCollected: collectedItems(state, options.items).length,
  };
}

/**
 * Proyecta el fin de partida a la pantalla de resultados, o `undefined` si la
 * partida sigue en curso. Es la única proyección que consume `web`.
 */
export function buildSessionSummary(
  state: GameState,
  options: SessionSummaryOptions = {},
): SessionSummary | undefined {
  const result = resolveSessionResult(state, options);
  if (!result) return undefined;

  const now = options.now ?? state.endedAt ?? state.lastTickAt;
  return {
    result,
    endedAt: state.endedAt ?? now,
    stats: computeSessionStats(state, { ...options, now }),
    solvedPuzzles: solvedPuzzleIds(state),
    items: collectedItems(state, options.items),
  };
}

/**
 * Cierra la partida cuando el motor no lo hizo por reglas (p. ej. todos los
 * jugadores abandonan, specs/04 §5). **Idempotente**: si la partida ya terminó
 * devuelve el mismo estado sin tocarlo, así `end_game` repetido no cambia el
 * resultado. Devuelve una copia; no muta la entrada.
 */
export function endSession(
  state: GameState,
  result: SessionResult,
  now: number = state.lastTickAt,
): GameState {
  if (state.result !== undefined || state.phase === "ended") return state;

  const next = structuredClone(state);
  next.result = toEngineResult(result);
  next.endedAt = now;
  next.phase = "ended";
  next.flags.game_ended = true;
  for (const timer of Object.values(next.timers)) timer.running = false;
  next.lastTickAt = now;
  return next;
}
