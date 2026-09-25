import type { PuzzleState } from "../schemas/puzzle";
import type { RoomPackage } from "../schemas/roompackage";
import type { FlagValue } from "../schemas/rules";
import { RESERVED_FLAGS } from "./constants";
import type { GameState, InitialStateOptions, PlayerRuntime, PuzzleRuntime } from "./types";

/**
 * Deriva el estado inicial de la partida desde la definición estática del
 * `RoomPackage` (specs/08 §3): objetos en su `initialState`, puzzles en
 * `available` (sin precondiciones) o `locked`, inventarios vacíos y flags
 * reservadas del sistema a `false`.
 */
export function createInitialState(
  roomPackage: RoomPackage,
  options: InitialStateOptions = {},
): GameState {
  const now = options.now ?? 0;

  const objectStates: Record<string, string> = {};
  for (const object of roomPackage.objects) {
    objectStates[object.id] = object.initialState;
  }

  const puzzleStates: Record<string, PuzzleRuntime> = {};
  for (const puzzle of roomPackage.puzzles) {
    const state: PuzzleState = puzzle.requiresSolved.length === 0 ? "available" : "locked";
    puzzleStates[puzzle.id] = { state, attempts: 0 };
  }

  const players: Record<string, PlayerRuntime> = {};
  const inventory: Record<string, string[]> = {};
  for (const playerId of options.playerIds ?? []) {
    players[playerId] = {};
    inventory[playerId] = [];
  }

  const flags: Record<string, FlagValue> = {
    [RESERVED_FLAGS.GAME_STARTED]: false,
    [RESERVED_FLAGS.GAME_ENDED]: false,
  };
  if (options.timeLimitSec !== undefined) {
    flags[RESERVED_FLAGS.TIME_REMAINING] = options.timeLimitSec;
  }

  return {
    flags,
    puzzleStates,
    inventory,
    objectStates,
    timers: {},
    hintsUsed: {},
    startedAt: now,
    timeLimitSec: options.timeLimitSec,
    phase: options.phase ?? "lobby",
    players,
    ruleRuns: {},
    reveals: {},
    deferred: [],
    lastTickAt: now,
  };
}
