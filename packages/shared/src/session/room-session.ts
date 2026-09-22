import {
  createEngine,
  createInitialState,
  type Engine,
  type EngineEffect,
  type EngineResult,
  type GameEvent,
  type GameState,
} from "../engine";
import {
  applyCombination,
  attemptCode,
  createCodeLockState,
  createCombineItemsState,
  createHiddenKeyState,
  revealHiddenKey,
  toCombineItemsPublicView,
  toHiddenKeyPublicView,
  toPublicView,
  type CodeLockAttemptOutcome,
  type CodeLockPublicView,
  type CodeLockState,
  type CombinationResult,
  type CombineItemsPublicView,
  type CombineItemsState,
  type HiddenKeyPublicView,
  type HiddenKeyState,
} from "../templates";
import {
  createHintState,
  requestHint,
  toHintPublicView,
  type HintPublicView,
  type HintRequestResult,
  type HintState,
} from "../hints";
import type {
  CodeLockDefinition,
  CombineItemsDefinition,
  HiddenKeyDefinition,
  PuzzleDefinition,
  RoomPackage,
} from "../schemas";
import { buildSessionSummary, type SessionSummary } from "./end-game";

/**
 * Sesión de sala (host) — pegamento puro entre el motor de reglas (1.4), las
 * plantillas de puzzle (1.5–1.7), las pistas (1.8) y el fin de partida (1.9).
 *
 * **No reimplementa** ninguna de esas piezas: delega en ellas y se limita a
 * traducir acciones de jugador a eventos de motor + llamadas de plantilla, y a
 * reconciliar el estado del mundo (`GameState`) con el estado interno de cada
 * plantilla. Es el mismo rol que en producción ejercen Colyseus/Phaser/React.
 *
 * Cada plantilla mantiene su estado propio (que **no** debe viajar al cliente):
 * este coordinador lo guarda y proyecta solo vistas públicas
 * (`to*PublicView`). Los ítems de una plantilla se reflejan en el inventario
 * del `GameState` para que las reglas (`item_in_inventory`) los vean.
 *
 * Es determinista y sin infraestructura: el reloj lógico entra por `now`, igual
 * que en el motor, de modo que el mismo guion produce el mismo estado.
 */

export interface RoomSessionOptions {
  /** Jugador principal (el que interactúa). Por defecto `p1`. */
  playerId?: string;
  /** Todos los jugadores de la partida (se siembran en el estado). */
  playerIds?: string[];
  /** Límite de tiempo de la partida, en segundos (stats y timeout). */
  timeLimitSec?: number;
  /** Reloj lógico inicial. Por defecto `0`. */
  now?: number;
}

/** Resultado de una interacción de mundo: eventos de motor + diálogos abiertos. */
export interface RoomInteractionResult {
  engine: EngineResult;
  /** Ids de diálogo que la interacción disparó (reglas `show_dialog`). */
  dialogIds: string[];
}

/** Resultado de un reveal de `hidden_key`, con el estado reconciliado. */
export interface RoomHiddenKeyResult {
  outcome: "revealed" | "already_revealed" | "unavailable";
  grantedItemId: string | null;
  engine: EngineResult | null;
}

/** Resultado de un intento de `code_lock`, con el estado reconciliado. */
export interface RoomCodeLockResult {
  outcome: CodeLockAttemptOutcome;
  remainingAttempts: number;
  lockedUntil: number | null;
  engine: EngineResult | null;
}

/** Resultado de una combinación, con el inventario reconciliado. */
export interface RoomCombineResult {
  result: CombinationResult;
  engine: EngineResult | null;
}

function findByType<T extends PuzzleDefinition["type"]>(
  roomPackage: RoomPackage,
  type: T,
): Extract<PuzzleDefinition, { type: T }>[] {
  return roomPackage.puzzles.filter(
    (puzzle): puzzle is Extract<PuzzleDefinition, { type: T }> => puzzle.type === type,
  );
}

export class RoomSession {
  readonly roomPackage: RoomPackage;
  readonly playerId: string;

  private readonly engine: Engine;
  private readonly hiddenKeyStates = new Map<string, HiddenKeyState>();
  private readonly codeLockStates = new Map<string, CodeLockState>();
  private readonly combineStates = new Map<string, CombineItemsState>();
  private hintState: HintState;
  private now: number;

  constructor(roomPackage: RoomPackage, options: RoomSessionOptions = {}) {
    this.roomPackage = roomPackage;
    this.playerId = options.playerId ?? "p1";
    this.now = options.now ?? 0;

    const playerIds = options.playerIds ?? [this.playerId];
    const state = createInitialState(roomPackage, {
      playerIds,
      ...(options.timeLimitSec !== undefined ? { timeLimitSec: options.timeLimitSec } : {}),
      now: this.now,
    });
    this.engine = createEngine(state, roomPackage.rules, {
      playerId: this.playerId,
      players: playerIds,
      now: this.now,
    });

    for (const puzzle of roomPackage.puzzles) {
      switch (puzzle.type) {
        case "hidden_key":
          this.hiddenKeyStates.set(puzzle.id, createHiddenKeyState(puzzle));
          break;
        case "code_lock":
          this.codeLockStates.set(puzzle.id, createCodeLockState(puzzle));
          break;
        case "combine_items":
          this.combineStates.set(puzzle.id, createCombineItemsState(puzzle, this.inventory()));
          break;
        default:
          break;
      }
    }

    this.hintState = createHintState(roomPackage.hints);
  }

  // — Lectura del estado del mundo ————————————————————————————————

  /** Copia serializable del estado del motor. */
  snapshot(): GameState {
    return this.engine.snapshot();
  }

  /** Estado vivo del motor (mutable por el motor). */
  get state(): GameState {
    return this.engine.state;
  }

  /** Inventario de un jugador (por defecto, el principal). */
  inventory(playerId: string = this.playerId): string[] {
    return [...(this.engine.state.inventory[playerId] ?? [])];
  }

  /** Estado actual de un objeto del mundo. */
  objectState(objectId: string): string | undefined {
    return this.engine.state.objectStates[objectId];
  }

  /** Valor de una flag del mundo. */
  flag(name: string): GameState["flags"][string] | undefined {
    return this.engine.state.flags[name];
  }

  /** `true` si el puzzle está resuelto. */
  isPuzzleSolved(puzzleId: string): boolean {
    return this.engine.state.puzzleStates[puzzleId]?.state === "solved";
  }

  /** Proyección pública de un `hidden_key`. */
  hiddenKeyView(puzzleId: string): HiddenKeyPublicView {
    const def = this.hiddenKeyDefinition(puzzleId);
    return toHiddenKeyPublicView(this.hiddenKeyStates.get(puzzleId)!, def);
  }

  /** Proyección pública de un `code_lock` (nunca incluye el código). */
  codeLockView(puzzleId: string): CodeLockPublicView {
    const def = this.codeLockDefinition(puzzleId);
    return toPublicView(this.codeLockStates.get(puzzleId)!, def);
  }

  /** Proyección pública de un `combine_items` (inventario del mundo). */
  combineItemsView(puzzleId: string): CombineItemsPublicView {
    const def = this.combineItemsDefinition(puzzleId);
    const state: CombineItemsState = {
      ...this.combineStates.get(puzzleId)!,
      inventory: this.inventory(),
    };
    return toCombineItemsPublicView(state, def);
  }

  /** Proyección pública de las pistas, resueltas al idioma pedido. */
  hintView(locale: string = this.roomPackage.meta.defaultLanguage): HintPublicView {
    return toHintPublicView(this.hintState, this.roomPackage.hints, locale);
  }

  /**
   * Panel asociado a un objeto del mundo, si lo hay: el `hidden_key` cuyo
   * escondite es ese objeto, o el puzzle que lo bloquea (`lockedBy`).
   */
  panelForObject(objectId: string): string | undefined {
    const hiding = this.roomPackage.puzzles.find(
      (puzzle) => puzzle.type === "hidden_key" && puzzle.hidingSpot.objectId === objectId,
    );
    if (hiding) return hiding.id;
    const object = this.roomPackage.objects.find((candidate) => candidate.id === objectId);
    return object?.lockedBy;
  }

  // — Acciones de jugador ——————————————————————————————————————————

  /** Arranca la partida (`on_game_start`): timer, intro y fase `playing`. */
  start(now: number = this.now): EngineResult {
    return this.dispatch({ type: "on_game_start" }, now);
  }

  /**
   * Interactúa con un objeto del mundo: dispara `on_interact` (reglas) y, si el
   * objeto es un escondite, revela el `hidden_key` correspondiente.
   */
  interact(objectId: string, now: number = this.now): RoomInteractionResult {
    const results: EngineResult[] = [
      this.dispatch({ type: "on_interact", objectId, playerId: this.playerId }, now),
    ];

    for (const puzzle of findByType(this.roomPackage, "hidden_key")) {
      if (puzzle.hidingSpot.objectId !== objectId) continue;
      const reveal = this.revealHiddenKey(puzzle.id, now);
      if (reveal.engine) results.push(reveal.engine);
    }

    const engine = mergeResults(now, results);
    const dialogIds = effectsOf(engine, "show_dialog").map((effect) => effect.dialogId);
    return { engine, dialogIds };
  }

  /** Revela un `hidden_key` (plantilla) y sincroniza el mundo si procede. */
  revealHiddenKey(puzzleId: string, now: number = this.now): RoomHiddenKeyResult {
    const def = this.hiddenKeyDefinition(puzzleId);
    const current = this.hiddenKeyStates.get(puzzleId)!;
    const reveal = revealHiddenKey(current, def, now, this.playerId);
    this.hiddenKeyStates.set(puzzleId, reveal.state);

    if (reveal.outcome !== "revealed") {
      return {
        outcome: reveal.outcome,
        grantedItemId: null,
        engine: null,
      };
    }

    const engine = this.completePuzzle(puzzleId, def, now);
    return { outcome: "revealed", grantedItemId: reveal.grantedItemId, engine };
  }

  /** Intenta abrir un `code_lock` con la plantilla (validación pura). */
  attemptCode(puzzleId: string, code: string, now: number = this.now): RoomCodeLockResult {
    const def = this.codeLockDefinition(puzzleId);
    const current = this.codeLockStates.get(puzzleId)!;
    const attempt = attemptCode(current, def, code, now);
    this.codeLockStates.set(puzzleId, attempt.state);

    const engine = attempt.outcome === "correct" ? this.completePuzzle(puzzleId, def, now) : null;

    return {
      outcome: attempt.outcome,
      remainingAttempts: attempt.remainingAttempts,
      lockedUntil: attempt.lockedUntil,
      engine,
    };
  }

  /** Combina dos ítems de un `combine_items` (plantilla) y sincroniza inventario. */
  combine(puzzleId: string, inputs: readonly string[], now: number = this.now): RoomCombineResult {
    const def = this.combineItemsDefinition(puzzleId);
    const current = this.combineStates.get(puzzleId)!;
    // El inventario vive en el `GameState`; la plantilla evalúa sobre esa foto.
    const seeded: CombineItemsState = { ...current, inventory: this.inventory() };
    const result = applyCombination(seeded, def, [...inputs], now);

    if (result.outcome !== "combined") {
      return { result, engine: null };
    }

    // Reconciliación: refleja consumo/entrega de la receta en el inventario del
    // mundo y persiste las recetas aplicadas (idempotencia de la plantilla).
    this.combineStates.set(puzzleId, result.state);
    this.engine.state.inventory[this.playerId] = [...result.state.inventory];
    const engine =
      result.state.state === "solved" && !this.isPuzzleSolved(puzzleId)
        ? this.completePuzzle(puzzleId, def, now)
        : null;

    return { result, engine };
  }

  /**
   * Resuelve un puzzle de mundo sin plantilla dedicada (p. ej. las placas
   * cooperativas, 06 §2.3, cuyo host detecta la condición y lo marca). El
   * servidor de producción lo hará desde su propia mecánica; aquí es el punto de
   * entrada para completar una sala vertical.
   */
  solveWorldPuzzle(puzzleId: string, now: number = this.now): EngineResult | null {
    const def = this.roomPackage.puzzles.find((puzzle) => puzzle.id === puzzleId);
    if (!def || this.isPuzzleSolved(puzzleId)) return null;
    return this.completePuzzle(puzzleId, def, now);
  }

  /** Pide la siguiente pista de un puzzle (1.8). */
  requestHint(puzzleId: string): HintRequestResult {
    const result = requestHint(this.hintState, this.roomPackage.hints, puzzleId);
    if (result.ok) {
      this.hintState = result.state;
      this.engine.state.hintsUsed[puzzleId] =
        (this.engine.state.hintsUsed[puzzleId] ?? 0) + result.cost;
    }
    return result;
  }

  /** Avanza el reloj lógico del motor (timers, `delay`, avisos). */
  tick(now: number): EngineResult {
    this.now = now;
    return this.engine.tick(now);
  }

  /** Resumen de fin de partida (1.9), o `undefined` si sigue en curso. */
  summary(now: number = this.now): SessionSummary | undefined {
    return buildSessionSummary(this.engine.state, {
      now,
      puzzlesTotal: this.roomPackage.puzzles.length,
    });
  }

  // — Interno ——————————————————————————————————————————————————————

  private dispatch(event: GameEvent, now: number): EngineResult {
    this.now = now;
    return this.engine.dispatch(event, now);
  }

  /**
   * Marca un puzzle como resuelto, dispara `on_puzzle_solved` (reglas del
   * fixture: transiciones de objeto, diálogos, flags) y otorga sus
   * `grantsItems` al jugador que interactúa. Idempotente.
   */
  private completePuzzle(
    puzzleId: string,
    def: PuzzleDefinition,
    now: number,
  ): EngineResult | null {
    if (this.isPuzzleSolved(puzzleId)) return null;

    this.engine.state.puzzleStates[puzzleId] = {
      state: "solved",
      attempts: this.engine.state.puzzleStates[puzzleId]?.attempts ?? 0,
      solvedAt: now,
      solvedBy: this.playerId,
    };
    const events: EngineResult[] = [
      this.dispatch({ type: "on_puzzle_solved", puzzleId, playerId: this.playerId }, now),
    ];

    for (const itemId of def.grantsItems) {
      events.push(this.engine.grantItem(itemId, "interactor", now));
    }

    return mergeResults(now, events);
  }

  private hiddenKeyDefinition(puzzleId: string): HiddenKeyDefinition {
    const def = this.roomPackage.puzzles.find((puzzle) => puzzle.id === puzzleId);
    if (!def || def.type !== "hidden_key") {
      throw new Error(`No hay un hidden_key con id «${puzzleId}».`);
    }
    return def;
  }

  private codeLockDefinition(puzzleId: string): CodeLockDefinition {
    const def = this.roomPackage.puzzles.find((puzzle) => puzzle.id === puzzleId);
    if (!def || def.type !== "code_lock") {
      throw new Error(`No hay un code_lock con id «${puzzleId}».`);
    }
    return def;
  }

  private combineItemsDefinition(puzzleId: string): CombineItemsDefinition {
    const def = this.roomPackage.puzzles.find((puzzle) => puzzle.id === puzzleId);
    if (!def || def.type !== "combine_items") {
      throw new Error(`No hay un combine_items con id «${puzzleId}».`);
    }
    return def;
  }
}

function effectsOf<T extends EngineEffect["type"]>(
  result: EngineResult,
  type: T,
): Extract<EngineEffect, { type: T }>[] {
  return result.effects.filter(
    (effect): effect is Extract<EngineEffect, { type: T }> => effect.type === type,
  );
}

function mergeResults(now: number, results: EngineResult[]): EngineResult {
  return {
    now,
    fired: results.flatMap((result) => result.fired),
    aborted: results.flatMap((result) => result.aborted),
    effects: results.flatMap((result) => result.effects),
    events: results.flatMap((result) => result.events),
    depthExceeded: results.some((result) => result.depthExceeded),
  };
}

/** Crea una sesión de sala sobre un `RoomPackage` ya validado. */
export function createRoomSession(
  roomPackage: RoomPackage,
  options: RoomSessionOptions = {},
): RoomSession {
  return new RoomSession(roomPackage, options);
}
