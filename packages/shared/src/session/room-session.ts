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
  createMemoryState,
  createPipesState,
  createSimultaneousPlatesState,
  createSlidingRng,
  createSlidingState,
  createSplitClueState,
  flipCard,
  moveSlidingTile,
  openPipesGate,
  pipesSeedFromId,
  placeSoloBridge,
  placeSplitClueBridge,
  revealHiddenKey,
  rotatePipe,
  setPlateActive,
  submitCombination,
  toCodeLockPublicView,
  toCombineItemsPublicView,
  toHiddenKeyPublicView,
  toMemoryPublicView,
  toPipesPuzzlePublicView,
  toSimultaneousPlatesPublicView,
  toSlidingPuzzlePublicView,
  toSplitCluePublicView,
  viewpointAt,
  type CodeLockAttemptOutcome,
  type CodeLockPublicView,
  type CodeLockState,
  type CombinationResult,
  type CombineItemsPublicView,
  type CombineItemsState,
  type HiddenKeyPublicView,
  type HiddenKeyState,
  type MemoryFlipOutcome,
  type MemoryPublicView,
  type MemoryState,
  type PipesGateOutcome,
  type PipesPuzzlePublicView,
  type PipesPuzzleState,
  type PipesRotateOutcome,
  type PlateOutcome,
  type SimultaneousPlatesPublicView,
  type SimultaneousPlatesState,
  type SlidingMoveOutcome,
  type SlidingPuzzlePublicView,
  type SlidingPuzzleState,
  type SplitClueBridgeOutcome,
  type SplitCluePublicView,
  type SplitClueState,
  type SplitClueSubmitOutcome,
} from "../templates";
import {
  createHintState,
  requestHint,
  toHintPublicView,
  type HintPublicView,
  type HintRequestResult,
  type HintState,
} from "../hints";
import { initialRoomOf, type PuzzleDefinition, type PuzzleState, type RoomPackage, type WorldObject } from "../schemas";
import { buildSessionSummary, endSession, type SessionSummary } from "./end-game";

/**
 * Sesión de sala (host) — pegamento puro entre el motor de reglas (1.4), las
 * **8 plantillas** de puzzle (1.5–1.7, 2.3–2.7), las pistas (1.8) y el fin de
 * partida (1.9). Es el núcleo autoritativo que ejecuta `GameRoom` (Colyseus) y,
 * en desarrollo, la página de playtest.
 *
 * **No reimplementa** ninguna de esas piezas: delega en ellas y se limita a
 * traducir acciones de jugador a eventos de motor + llamadas de plantilla, y a
 * reconciliar el estado del mundo (`GameState`) con el estado interno de cada
 * plantilla. Cada plantilla mantiene su estado propio (que **no** debe viajar
 * al cliente): este coordinador lo guarda y solo proyecta vistas públicas
 * (`to*PublicView`).
 *
 * Multijugador (ticket 2.8): toda acción acepta el jugador que la ejecuta
 * (`playerId`, por defecto el principal). Los ítems que otorga un puzzle van al
 * inventario de quien lo resuelve; las condiciones `item_in_inventory` son
 * cooperativas (cualquier jugador). La sesión también lleva la posición de cada
 * jugador (`movePlayer`): de ella salen el cambio de habitación (validado por
 * puertas abiertas), las placas en modo `stand` y el punto de vista de
 * `split_clue`.
 *
 * Es determinista y sin infraestructura: el reloj lógico entra por `now`, igual
 * que en el motor, de modo que el mismo guion produce el mismo estado.
 */

export interface RoomSessionOptions {
  /** Jugador principal (el que interactúa por defecto). Por defecto `p1`. */
  playerId?: string;
  /** Todos los jugadores de la partida (se siembran en el estado). */
  playerIds?: string[];
  /** Límite de tiempo de la partida, en segundos (stats y timeout). */
  timeLimitSec?: number;
  /** Reloj lógico inicial. Por defecto `0`. */
  now?: number;
  /**
   * Fuente de azar por puzzle (reparto del `memory`, `sliding_puzzle` con
   * `scramble: "random"`). Por defecto es **determinista por id** del puzzle,
   * así que el mismo paquete produce siempre el mismo tablero; el servidor de
   * producción inyecta una semilla aleatoria por partida.
   */
  rng?: (puzzleId: string) => () => number;
}

/** Motivo por el que la sesión rechaza una acción antes de llegar al motor. */
export type RoomRejection = "wrong_room" | "missing_item" | "game_over";

/** Resultado de una interacción de mundo: eventos de motor + diálogos abiertos. */
export interface RoomInteractionResult {
  engine: EngineResult;
  /** Ids de diálogo que la interacción disparó (reglas `show_dialog`). */
  dialogIds: string[];
  /** Presente si la sesión rechazó la acción (el motor no llegó a evaluarla). */
  rejected?: RoomRejection;
}

/**
 * Acción disponible sobre un objeto del mundo (specs/05 §3). El runtime deriva
 * de aquí su menú contextual: `on_interact` → `inspect`, `on_use_item` →
 * `use_item`.
 */
export type RoomObjectAction = "inspect" | "use_item";

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

/** Resultado genérico de una acción de plantilla (desenlace + motor si resolvió). */
export interface RoomPuzzleActionResult<Outcome extends string> {
  outcome: Outcome;
  /** Resultado del motor si la acción resolvió el puzzle (`on_puzzle_solved`). */
  engine: EngineResult | null;
}

/** Resultado de voltear una carta de `memory`. */
export interface RoomMemoryFlipResult extends RoomPuzzleActionResult<MemoryFlipOutcome> {
  /** Símbolo revelado por esta acción (solo al emisor; nunca en el estado). */
  revealedSymbol: string | null;
}

/** Posición de un jugador en el mundo (celdas del grid de su habitación). */
export interface RoomPlayerPosition {
  roomId: string;
  x: number;
  y: number;
}

/** Desenlace de mover a un jugador. */
export type RoomMoveOutcome = "moved" | "room_locked" | "unknown_room" | "game_over";

/** Resultado de `movePlayer`: motor (entrada en habitación, placas) + placas cambiadas. */
export interface RoomMoveResult {
  outcome: RoomMoveOutcome;
  /** `true` si el jugador cambió de habitación (se disparó `on_enter_room`). */
  enteredRoom: boolean;
  engine: EngineResult;
  /** Placas cuyo estado cambió por el movimiento (modo `stand`). */
  plates: { puzzleId: string; plateObjectId: string; outcome: PlateOutcome }[];
}

/** Proyección pública de cualquier plantilla (lo que viaja al cliente). */
export type RoomPuzzlePublicView =
  | HiddenKeyPublicView
  | CodeLockPublicView
  | CombineItemsPublicView
  | SimultaneousPlatesPublicView
  | SlidingPuzzlePublicView
  | MemoryPublicView
  | SplitCluePublicView
  | PipesPuzzlePublicView;

type PuzzleOf<T extends PuzzleDefinition["type"]> = Extract<PuzzleDefinition, { type: T }>;

/** Estado interno de cada plantilla, indexado por id de puzzle. */
interface TemplateStates {
  hidden_key: Map<string, HiddenKeyState>;
  code_lock: Map<string, CodeLockState>;
  combine_items: Map<string, CombineItemsState>;
  simultaneous_plates: Map<string, SimultaneousPlatesState>;
  sliding_puzzle: Map<string, SlidingPuzzleState>;
  memory: Map<string, MemoryState>;
  split_clue: Map<string, SplitClueState>;
  pipes: Map<string, PipesPuzzleState>;
}

/** Estado de plantilla con el campo común `state` (todas lo tienen). */
interface WithPuzzleState {
  state: PuzzleState;
}

/** Semilla determinista por id (FNV-1a) + mulberry32: el azar por defecto. */
function defaultRng(puzzleId: string): () => number {
  return createSlidingRng(pipesSeedFromId(puzzleId));
}

/** Estado de puerta abierta (`unlock_door` del motor). */
const DOOR_OPEN_STATE = "open";

export class RoomSession {
  readonly roomPackage: RoomPackage;
  readonly playerId: string;

  private readonly engine: Engine;
  private readonly templates: TemplateStates = {
    hidden_key: new Map(),
    code_lock: new Map(),
    combine_items: new Map(),
    simultaneous_plates: new Map(),
    sliding_puzzle: new Map(),
    memory: new Map(),
    split_clue: new Map(),
    pipes: new Map(),
  };
  private readonly puzzlesById = new Map<string, PuzzleDefinition>();
  private readonly objectsById = new Map<string, WorldObject>();
  /** Escondites sin `hidden_key` ya vaciados (se reparte su contenido una vez). */
  private readonly emptiedHidingSpots = new Set<string>();
  private readonly positions = new Map<string, RoomPlayerPosition>();
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

    for (const object of roomPackage.objects) this.objectsById.set(object.id, object);

    const rngFor = options.rng ?? defaultRng;
    for (const puzzle of roomPackage.puzzles) {
      this.puzzlesById.set(puzzle.id, puzzle);
      switch (puzzle.type) {
        case "hidden_key":
          this.templates.hidden_key.set(puzzle.id, createHiddenKeyState(puzzle));
          break;
        case "code_lock":
          this.templates.code_lock.set(puzzle.id, createCodeLockState(puzzle));
          break;
        case "combine_items":
          this.templates.combine_items.set(
            puzzle.id,
            createCombineItemsState(puzzle, this.inventory()),
          );
          break;
        case "simultaneous_plates":
          this.templates.simultaneous_plates.set(puzzle.id, createSimultaneousPlatesState(puzzle));
          break;
        case "sliding_puzzle":
          this.templates.sliding_puzzle.set(
            puzzle.id,
            createSlidingState(
              puzzle,
              puzzle.scramble === "random" ? rngFor(puzzle.id) : undefined,
            ),
          );
          break;
        case "memory":
          this.templates.memory.set(puzzle.id, createMemoryState(puzzle, rngFor(puzzle.id)));
          break;
        case "split_clue":
          this.templates.split_clue.set(puzzle.id, createSplitClueState(puzzle));
          break;
        case "pipes":
          this.templates.pipes.set(puzzle.id, createPipesState(puzzle));
          break;
      }
    }

    this.hintState = createHintState(roomPackage.hints);
  }

  // — Lectura del estado del mundo ————————————————————————————————

  /**
   * C-19: índice O(1) por id, para el camino caliente de `GameRoom` (evita
   * `roomPackage.puzzles.find`/`objects.find` en cada acción o tick).
   */
  getPuzzleDefinition(puzzleId: string): PuzzleDefinition | undefined {
    return this.puzzlesById.get(puzzleId);
  }

  /** C-19: índice O(1) por id de los objetos del mundo. */
  getObjectDefinition(objectId: string): WorldObject | undefined {
    return this.objectsById.get(objectId);
  }

  /** Copia serializable del estado del motor. */
  snapshot(): GameState {
    return this.engine.snapshot();
  }

  /** Estado vivo del motor (mutable por el motor). */
  get state(): GameState {
    return this.engine.state;
  }

  /** `true` si la partida ya terminó (`victory`, `timeout`, `abandoned`). */
  get ended(): boolean {
    return this.engine.state.result !== undefined;
  }

  /** Jugadores de la partida. */
  players(): string[] {
    return Object.keys(this.engine.state.players);
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

  /** Estado del puzzle en el mundo (`locked`, `available`, …, `solved`). */
  puzzleState(puzzleId: string): PuzzleState | undefined {
    return this.engine.state.puzzleStates[puzzleId]?.state;
  }

  /** `true` si el puzzle está resuelto. */
  isPuzzleSolved(puzzleId: string): boolean {
    return this.engine.state.puzzleStates[puzzleId]?.state === "solved";
  }

  /** Posición conocida de un jugador (tras `movePlayer`/`spawnPlayer`). */
  playerPosition(playerId: string = this.playerId): RoomPlayerPosition | undefined {
    const position = this.positions.get(playerId);
    return position ? { ...position } : undefined;
  }

  /** Proyección pública de un `hidden_key`. */
  hiddenKeyView(puzzleId: string): HiddenKeyPublicView {
    const def = this.definition(puzzleId, "hidden_key");
    return toHiddenKeyPublicView(this.templates.hidden_key.get(puzzleId)!, def);
  }

  /** Proyección pública de un `code_lock` (nunca incluye el código). */
  codeLockView(puzzleId: string): CodeLockPublicView {
    const def = this.definition(puzzleId, "code_lock");
    return toCodeLockPublicView(this.templates.code_lock.get(puzzleId)!, def);
  }

  /** Proyección pública de un `combine_items` sobre el inventario de un jugador. */
  combineItemsView(puzzleId: string, playerId: string = this.playerId): CombineItemsPublicView {
    const def = this.definition(puzzleId, "combine_items");
    const state: CombineItemsState = {
      ...this.templates.combine_items.get(puzzleId)!,
      inventory: this.inventory(playerId),
    };
    return toCombineItemsPublicView(state, def);
  }

  /** Proyección pública de un `simultaneous_plates` (sin el objeto-puente). */
  platesView(puzzleId: string, now: number = this.now): SimultaneousPlatesPublicView {
    const def = this.definition(puzzleId, "simultaneous_plates");
    return toSimultaneousPlatesPublicView(
      this.templates.simultaneous_plates.get(puzzleId)!,
      def,
      now,
    );
  }

  /** Proyección pública de un `sliding_puzzle` (sin semilla). */
  slidingView(puzzleId: string): SlidingPuzzlePublicView {
    const def = this.definition(puzzleId, "sliding_puzzle");
    return toSlidingPuzzlePublicView(this.templates.sliding_puzzle.get(puzzleId)!, def);
  }

  /** Proyección pública de un `memory` (sin símbolos de cartas boca abajo). */
  memoryView(puzzleId: string): MemoryPublicView {
    const def = this.definition(puzzleId, "memory");
    return toMemoryPublicView(this.templates.memory.get(puzzleId)!, def);
  }

  /**
   * Proyección pública de un `split_clue` **para un jugador**: el punto de vista
   * sale de su posición en el servidor (zona de la mirilla). Fuera de toda zona
   * no ve ningún fragmento (salvo que el espejo ya esté colocado).
   */
  splitClueView(puzzleId: string, playerId: string = this.playerId): SplitCluePublicView {
    const def = this.definition(puzzleId, "split_clue");
    return toSplitCluePublicView(
      this.templates.split_clue.get(puzzleId)!,
      def,
      this.viewpointOf(puzzleId, playerId) ?? "",
    );
  }

  /** Mirilla (viewpoint) que ocupa un jugador en un `split_clue`, o `null`. */
  viewpointOf(puzzleId: string, playerId: string = this.playerId): string | null {
    const def = this.definition(puzzleId, "split_clue");
    const position = this.positions.get(playerId);
    if (!position || position.roomId !== def.roomId) return null;
    return viewpointAt(def, Math.round(position.x), Math.round(position.y));
  }

  /** Proyección pública de un `pipes` (sin `solution` ni semilla). */
  pipesView(puzzleId: string): PipesPuzzlePublicView {
    const def = this.definition(puzzleId, "pipes");
    return toPipesPuzzlePublicView(this.templates.pipes.get(puzzleId)!, def);
  }

  /**
   * Proyección pública de cualquier puzzle para un jugador (lo que el servidor
   * envía al panel). Nunca incluye soluciones: delega en el `to*PublicView` de
   * cada plantilla.
   */
  puzzleView(puzzleId: string, playerId: string = this.playerId): RoomPuzzlePublicView {
    const def = this.puzzlesById.get(puzzleId);
    if (!def) throw new Error(`No hay un puzzle con id «${puzzleId}».`);
    switch (def.type) {
      case "hidden_key":
        return this.hiddenKeyView(puzzleId);
      case "code_lock":
        return this.codeLockView(puzzleId);
      case "combine_items":
        return this.combineItemsView(puzzleId, playerId);
      case "simultaneous_plates":
        return this.platesView(puzzleId);
      case "sliding_puzzle":
        return this.slidingView(puzzleId);
      case "memory":
        return this.memoryView(puzzleId);
      case "split_clue":
        return this.splitClueView(puzzleId, playerId);
      case "pipes":
        return this.pipesView(puzzleId);
    }
  }

  /** Proyección pública de las pistas, resueltas al idioma pedido. */
  hintView(locale: string = this.roomPackage.meta.defaultLanguage): HintPublicView {
    return toHintPublicView(this.hintState, this.roomPackage.hints, locale);
  }

  /**
   * Panel asociado a un objeto del mundo, si lo hay: el `hidden_key` cuyo
   * escondite es ese objeto, el puzzle que lo bloquea (`lockedBy`) o el
   * `split_clue` que lo usa como mirilla.
   */
  panelForObject(objectId: string): string | undefined {
    const hiding = this.roomPackage.puzzles.find(
      (puzzle) => puzzle.type === "hidden_key" && puzzle.hidingSpot.objectId === objectId,
    );
    if (hiding) return hiding.id;
    const object = this.objectsById.get(objectId);
    if (object?.lockedBy) return object.lockedBy;
    const split = this.roomPackage.puzzles.find(
      (puzzle) =>
        puzzle.type === "split_clue" &&
        puzzle.viewpoints.some((viewpoint) => viewpoint.objectId === objectId),
    );
    return split?.id;
  }

  /**
   * Acciones que el motor declara para un objeto, derivadas de sus reglas
   * (specs/05 §3): `on_interact` → `inspect`; `on_use_item` → `use_item`. Si el
   * paquete no declara ninguna para el objeto, se devuelve el set base
   * `["inspect", "use_item"]` para que el menú contextual siga siendo útil. Así
   * el menú es **extensible por datos**: una regla nueva amplía las acciones sin
   * tocar la UI.
   */
  availableActions(objectId: string): RoomObjectAction[] {
    const actions: RoomObjectAction[] = [];
    for (const rule of this.roomPackage.rules) {
      if (rule.trigger.type === "on_interact" && rule.trigger.objectId === objectId) {
        if (!actions.includes("inspect")) actions.push("inspect");
      } else if (rule.trigger.type === "on_use_item" && rule.trigger.objectId === objectId) {
        if (!actions.includes("use_item")) actions.push("use_item");
      }
    }
    return actions.length > 0 ? actions : ["inspect", "use_item"];
  }

  // — Jugadores y movimiento ——————————————————————————————————————

  /** Añade un jugador a la partida (join a mitad). Idempotente. */
  addPlayer(playerId: string): void {
    this.engine.state.players[playerId] ??= {};
    this.engine.state.inventory[playerId] ??= [];
  }

  /**
   * Traspasa el estado de juego (posición, inventario, runtime del motor,
   * autoría de placas/puzzles) de `oldPlayerId` a `newPlayerId` (C-1/C-2,
   * auditoría 2026-09-24): la MISMA persona vuelve con una `sessionId`
   * distinta (pestaña duplicada que hereda la plaza, o reconexión sin el
   * token nativo de Colyseus), nunca alguien nuevo. Es responsabilidad del
   * llamador no invocarlo si `newPlayerId` ya tiene estado propio. No-op si
   * `oldPlayerId` no tenía estado (la plaza ya se había purgado).
   */
  renamePlayer(oldPlayerId: string, newPlayerId: string): void {
    if (oldPlayerId === newPlayerId) return;
    const position = this.positions.get(oldPlayerId);
    if (position !== undefined) {
      this.positions.set(newPlayerId, position);
      this.positions.delete(oldPlayerId);
    }
    const inventory = this.engine.state.inventory[oldPlayerId];
    if (inventory !== undefined) {
      this.engine.state.inventory[newPlayerId] = inventory;
      delete this.engine.state.inventory[oldPlayerId];
    }
    const runtime = this.engine.state.players[oldPlayerId];
    if (runtime !== undefined) {
      this.engine.state.players[newPlayerId] = runtime;
      delete this.engine.state.players[oldPlayerId];
    }
    for (const runtime of Object.values(this.engine.state.puzzleStates)) {
      if (runtime.solvedBy === oldPlayerId) runtime.solvedBy = newPlayerId;
    }
    for (const state of this.templates.simultaneous_plates.values()) {
      for (const plate of Object.values(state.plates)) {
        if (plate.activatedBy === oldPlayerId) plate.activatedBy = newPlayerId;
      }
    }
  }

  /**
   * Coloca a un jugador en un punto de aparición de la habitación inicial (la
   * primera del mapa que no es la sala de espera, `initialRoomOf`) o de la
   * pedida (p. ej. el lobby). No valida puertas: es la entrada a la
   * partida, no un movimiento.
   */
  spawnPlayer(playerId: string, now: number = this.now, roomId?: string): RoomMoveResult {
    this.addPlayer(playerId);
    const room =
      this.roomPackage.map.rooms.find((candidate) => candidate.id === roomId) ??
      initialRoomOf(this.roomPackage.map);
    if (!room) {
      return { outcome: "unknown_room", enteredRoom: false, engine: emptyResult(now), plates: [] };
    }
    const index = [...this.positions.values()].filter((p) => p.roomId === room.id).length;
    const spawn = room.spawnPoints[index % Math.max(1, room.spawnPoints.length)] ?? { x: 0, y: 0 };
    return this.placePlayer(playerId, { roomId: room.id, x: spawn.x, y: spawn.y }, now);
  }

  /**
   * ¿Puede un jugador pasar de `from` a `to`? Solo a través de una puerta
   * abierta que conecte ambas habitaciones (en cualquier sentido): la puerta
   * vive en una y su `leadsTo` apunta a la otra.
   */
  canEnterRoom(from: string | undefined, to: string): boolean {
    if (!this.roomPackage.map.rooms.some((room) => room.id === to)) return false;
    if (from === undefined) return to === initialRoomOf(this.roomPackage.map)?.id;
    if (from === to) return true;
    return this.roomPackage.objects.some(
      (object) =>
        object.leadsTo !== undefined &&
        this.engine.state.objectStates[object.id] === DOOR_OPEN_STATE &&
        ((object.roomId === from && object.leadsTo === to) ||
          (object.roomId === to && object.leadsTo === from)),
    );
  }

  /**
   * Mueve a un jugador (posición autoritativa del servidor). Cambiar de
   * habitación exige una puerta abierta y dispara `on_enter_room`; en modo
   * `stand`, pisar o dejar una placa la activa o desactiva. La validación de
   * velocidad (anti-teletransporte) es del transporte (Colyseus), no de aquí.
   */
  movePlayer(
    playerId: string,
    roomId: string,
    x: number,
    y: number,
    now: number = this.now,
  ): RoomMoveResult {
    this.now = now;
    if (this.ended) {
      return { outcome: "game_over", enteredRoom: false, engine: emptyResult(now), plates: [] };
    }
    if (!this.roomPackage.map.rooms.some((room) => room.id === roomId)) {
      return { outcome: "unknown_room", enteredRoom: false, engine: emptyResult(now), plates: [] };
    }
    const current = this.positions.get(playerId);
    if (!this.canEnterRoom(current?.roomId, roomId)) {
      return { outcome: "room_locked", enteredRoom: false, engine: emptyResult(now), plates: [] };
    }
    return this.placePlayer(playerId, { roomId, x, y }, now);
  }

  // — Acciones de jugador ——————————————————————————————————————————

  /** Arranca la partida (`on_game_start`): timer, intro y fase `playing`. */
  start(now: number = this.now): EngineResult {
    return this.dispatch({ type: "on_game_start" }, now);
  }

  /**
   * Cierra la partida como abandonada (ticket partidas-abandonadas, specs/04
   * §5): cierre externo sin resultado del motor, para cuando la `GameRoom`
   * detecta que lleva `ABANDONED_GAME_TIMEOUT_SEC` sin ningún jugador
   * conectado. Reutiliza `endSession` (idempotente: si la partida ya terminó
   * no hace nada) mutando el estado del motor en vez de sustituirlo, porque
   * `Engine.state` no expone un setter.
   */
  abort(now: number = this.now): void {
    const state = this.engine.state;
    const next = endSession(state, "aborted", now);
    if (next !== state) Object.assign(state, next);
  }

  /**
   * Interactúa con un objeto del mundo: dispara `on_interact` (reglas) y, si el
   * objeto es un escondite, revela el `hidden_key` correspondiente (o reparte
   * su contenido si el escondite no tiene plantilla, p. ej. el barril del
   * espejo). Si la posición del jugador es conocida, el objeto debe estar en su
   * habitación.
   */
  interact(
    objectId: string,
    now: number = this.now,
    playerId: string = this.playerId,
  ): RoomInteractionResult {
    const rejected = this.rejectWorldAction(objectId, playerId);
    if (rejected) return { engine: emptyResult(now), dialogIds: [], rejected };

    const results: EngineResult[] = [
      this.dispatch({ type: "on_interact", objectId, playerId }, now),
    ];

    let hasTemplate = false;
    for (const puzzle of this.puzzlesOfType("hidden_key")) {
      if (puzzle.hidingSpot.objectId !== objectId) continue;
      hasTemplate = true;
      const reveal = this.revealHiddenKey(puzzle.id, now, playerId);
      if (reveal.engine) results.push(reveal.engine);
    }
    if (!hasTemplate) {
      const loot = this.emptyHidingSpot(objectId, now, playerId);
      if (loot) results.push(loot);
    }

    const engine = mergeResults(now, results);
    return { engine, dialogIds: dialogIdsOf(engine) };
  }

  /**
   * Usa un objeto del inventario sobre un objeto del mundo (drag&drop o acción
   * "Usar objeto…"): dispara `on_use_item` con `{ itemId, objectId }`. Si el
   * ítem es el objeto-puente de una mecánica cooperativa (el cáliz sobre una
   * placa, el espejo en una mirilla) o abre una compuerta de `pipes`, la
   * plantilla correspondiente lo aplica. Desde 2.11 el puente **se consume**
   * al fijarse (un objeto, un uso, como cualquier otro ítem de un escape
   * room): desaparece del inventario en cuanto la placa/mirilla queda fijada.
   * La compuerta de `pipes` sigue sin consumirse (es una llave, no un
   * puente). Es pura e idempotente como `interact`.
   */
  useItemOnObject(
    itemId: string,
    objectId: string,
    now: number = this.now,
    playerId: string = this.playerId,
  ): RoomInteractionResult {
    const rejected =
      this.rejectWorldAction(objectId, playerId) ??
      (this.inventory(playerId).includes(itemId) ? undefined : ("missing_item" as const));
    if (rejected) return { engine: emptyResult(now), dialogIds: [], rejected };

    const results: EngineResult[] = [
      this.dispatch({ type: "on_use_item", itemId, objectId, playerId }, now),
    ];

    for (const puzzle of this.puzzlesOfType("simultaneous_plates")) {
      if (puzzle.soloBridgeItemId !== itemId) continue;
      if (!puzzle.plates.some((plate) => plate.objectId === objectId)) continue;
      const bridged = this.placePlatesBridge(puzzle.id, objectId, now, playerId);
      if (bridged.engine) results.push(bridged.engine);
      if (bridged.outcome === "solved" || bridged.outcome === "activated") {
        const consumed = this.consumeInventoryItem(itemId, playerId, now);
        if (consumed) results.push(consumed);
      }
    }
    for (const puzzle of this.puzzlesOfType("split_clue")) {
      if (puzzle.soloBridgeItemId !== itemId) continue;
      if (!puzzle.viewpoints.some((viewpoint) => viewpoint.objectId === objectId)) continue;
      const outcome = this.placeSplitClueBridge(puzzle.id, playerId);
      if (outcome === "bridged") {
        const consumed = this.consumeInventoryItem(itemId, playerId, now);
        if (consumed) results.push(consumed);
      }
    }

    const engine = mergeResults(now, results);
    return { engine, dialogIds: dialogIdsOf(engine) };
  }

  /** Revela un `hidden_key` (plantilla) y sincroniza el mundo si procede. */
  revealHiddenKey(
    puzzleId: string,
    now: number = this.now,
    playerId: string = this.playerId,
  ): RoomHiddenKeyResult {
    const def = this.definition(puzzleId, "hidden_key");
    if (this.ended) return { outcome: "unavailable", grantedItemId: null, engine: null };
    const reveal = revealHiddenKey(this.templates.hidden_key.get(puzzleId)!, def, now, playerId);
    this.templates.hidden_key.set(puzzleId, reveal.state);

    if (reveal.outcome !== "revealed") {
      return { outcome: reveal.outcome, grantedItemId: null, engine: null };
    }

    const engine = this.completePuzzle(puzzleId, def, now, playerId);
    return { outcome: "revealed", grantedItemId: reveal.grantedItemId, engine };
  }

  /** Intenta abrir un `code_lock` con la plantilla (validación pura). */
  attemptCode(
    puzzleId: string,
    code: string,
    now: number = this.now,
    playerId: string = this.playerId,
  ): RoomCodeLockResult {
    const def = this.definition(puzzleId, "code_lock");
    const current = this.templates.code_lock.get(puzzleId)!;
    if (this.ended) {
      return { outcome: "unavailable", remainingAttempts: 0, lockedUntil: null, engine: null };
    }
    const attempt = attemptCode(current, def, code, now);
    this.templates.code_lock.set(puzzleId, attempt.state);
    this.syncRuntime(puzzleId, attempt.state, attempt.state.attempts);

    const engine =
      attempt.outcome === "correct" ? this.completePuzzle(puzzleId, def, now, playerId) : null;

    return {
      outcome: attempt.outcome,
      remainingAttempts: attempt.remainingAttempts,
      lockedUntil: attempt.lockedUntil,
      engine,
    };
  }

  /** Combina ítems de un `combine_items` (plantilla) y sincroniza el inventario del jugador. */
  combine(
    puzzleId: string,
    inputs: readonly string[],
    now: number = this.now,
    playerId: string = this.playerId,
  ): RoomCombineResult {
    const def = this.definition(puzzleId, "combine_items");
    const current = this.templates.combine_items.get(puzzleId)!;
    // El inventario vive en el `GameState`; la plantilla evalúa sobre esa foto.
    const seeded: CombineItemsState = {
      ...current,
      inventory: this.inventory(playerId),
      ...(this.ended ? { state: "failed" as const } : {}),
    };
    const result = applyCombination(seeded, def, [...inputs], now);

    if (result.outcome !== "combined") {
      return { result, engine: null };
    }

    // Reconciliación: refleja consumo/entrega de la receta en el inventario del
    // mundo y persiste las recetas aplicadas (idempotencia de la plantilla).
    this.templates.combine_items.set(puzzleId, result.state);
    this.engine.state.inventory[playerId] = [...result.state.inventory];
    const engine =
      result.state.state === "solved" && !this.isPuzzleSolved(puzzleId)
        ? this.completePuzzle(puzzleId, def, now, playerId)
        : null;

    return { result, engine };
  }

  /**
   * Activa o desactiva una placa (`plate_state`, specs/11 §4.3). Para activar,
   * el jugador tiene que estar encima (±½ celda) si su posición es conocida:
   * el cliente no puede pisar placas a distancia. En modo `stand` lo normal es
   * que lo haga `movePlayer`.
   */
  setPlate(
    puzzleId: string,
    plateObjectId: string,
    active: boolean,
    now: number = this.now,
    playerId: string = this.playerId,
  ): RoomPuzzleActionResult<PlateOutcome> {
    const def = this.definition(puzzleId, "simultaneous_plates");
    if (this.ended) return { outcome: "unavailable", engine: null };
    const plate = def.plates.find((candidate) => candidate.objectId === plateObjectId);
    if (!plate) return { outcome: "unknown_plate", engine: null };
    const position = this.positions.get(playerId);
    // C-6: exigir estar sobre la placa también para DESACTIVARLA (antes solo
    // se comprobaba al activar); si no, cualquiera la apaga a distancia.
    if (position && (position.roomId !== def.roomId || !isOnCell(position, plate.x, plate.y))) {
      return { outcome: "unavailable", engine: null };
    }
    return this.applyPlate(puzzleId, plateObjectId, active, now, playerId);
  }

  /** Voltea una carta de `memory` (turnos y aciertos en la plantilla). */
  flipMemoryCard(
    puzzleId: string,
    cardId: string,
    now: number = this.now,
    playerId: string = this.playerId,
  ): RoomMemoryFlipResult {
    const def = this.definition(puzzleId, "memory");
    if (this.ended) return { outcome: "unavailable", engine: null, revealedSymbol: null };
    // La rotación de turno en `turnMode: "per_player"` necesita conocer a los
    // jugadores reales de la partida (auditoría D-8): antes leía `def.players`,
    // un campo que el esquema Zod elimina, así que nunca rotaba.
    const flip = flipCard(this.templates.memory.get(puzzleId)!, def, cardId, playerId, now, {
      players: this.players(),
    });
    this.templates.memory.set(puzzleId, flip.state);
    this.syncRuntime(puzzleId, flip.state);
    const engine = flip.solved ? this.completePuzzle(puzzleId, def, now, playerId) : null;
    return { outcome: flip.outcome, engine, revealedSymbol: flip.revealedSymbol };
  }

  /** Desliza una ficha del `sliding_puzzle` hacia el hueco. */
  moveSlidingTile(
    puzzleId: string,
    index: number,
    now: number = this.now,
    playerId: string = this.playerId,
  ): RoomPuzzleActionResult<SlidingMoveOutcome> {
    const def = this.definition(puzzleId, "sliding_puzzle");
    if (this.ended) return { outcome: "unavailable", engine: null };
    const moved = moveSlidingTile(this.templates.sliding_puzzle.get(puzzleId)!, def, index, now);
    this.templates.sliding_puzzle.set(puzzleId, moved.state);
    this.syncRuntime(puzzleId, moved.state);
    const engine =
      moved.outcome === "solved" ? this.completePuzzle(puzzleId, def, now, playerId) : null;
    return { outcome: moved.outcome, engine };
  }

  /** Gira una pieza del `pipes` (cuartos de vuelta horarios). */
  rotatePipe(
    puzzleId: string,
    index: number,
    now: number = this.now,
    playerId: string = this.playerId,
    turns = 1,
  ): RoomPuzzleActionResult<PipesRotateOutcome> {
    const def = this.definition(puzzleId, "pipes");
    if (this.ended) return { outcome: "unavailable", engine: null };
    const rotated = rotatePipe(
      this.templates.pipes.get(puzzleId)!,
      def,
      index,
      now,
      turns,
      playerId,
    );
    this.templates.pipes.set(puzzleId, rotated.state);
    this.syncRuntime(puzzleId, rotated.state);
    const engine =
      rotated.outcome === "solved" ? this.completePuzzle(puzzleId, def, now, playerId) : null;
    return { outcome: rotated.outcome, engine };
  }

  /**
   * Presenta el objeto de una compuerta de `pipes` (la `llave-oro`). Solo vale
   * el inventario **de quien lo presenta**; el objeto no se consume.
   */
  openPipesGate(
    puzzleId: string,
    index: number,
    now: number = this.now,
    playerId: string = this.playerId,
  ): RoomPuzzleActionResult<PipesGateOutcome> {
    const def = this.definition(puzzleId, "pipes");
    if (this.ended) return { outcome: "unavailable", engine: null };
    const opened = openPipesGate(
      this.templates.pipes.get(puzzleId)!,
      def,
      index,
      this.inventory(playerId),
      now,
      playerId,
    );
    this.templates.pipes.set(puzzleId, opened.state);
    this.syncRuntime(puzzleId, opened.state);
    const engine =
      opened.outcome === "solved" ? this.completePuzzle(puzzleId, def, now, playerId) : null;
    return { outcome: opened.outcome, engine };
  }

  /** Envía la combinación de un `split_clue` (símbolos o código). */
  submitSplitClue(
    puzzleId: string,
    input: string | string[],
    now: number = this.now,
    playerId: string = this.playerId,
  ): RoomPuzzleActionResult<SplitClueSubmitOutcome> {
    const def = this.definition(puzzleId, "split_clue");
    if (this.ended) return { outcome: "unavailable", engine: null };
    const submitted = submitCombination(
      this.templates.split_clue.get(puzzleId)!,
      def,
      input,
      now,
      playerId,
    );
    this.templates.split_clue.set(puzzleId, submitted.state);
    this.syncRuntime(puzzleId, submitted.state, submitted.attempts);
    const engine =
      submitted.outcome === "correct" ? this.completePuzzle(puzzleId, def, now, playerId) : null;
    return { outcome: submitted.outcome, engine };
  }

  /**
   * Resuelve un puzzle de mundo sin pasar por su plantilla. Se mantiene por
   * compatibilidad con el playtest de la Sala 1 (1.10); las placas ya tienen su
   * mecánica real en `movePlayer`/`setPlate`/puente.
   */
  solveWorldPuzzle(
    puzzleId: string,
    now: number = this.now,
    playerId: string = this.playerId,
  ): EngineResult | null {
    const def = this.puzzlesById.get(puzzleId);
    if (!def || this.isPuzzleSolved(puzzleId) || this.ended) return null;
    return this.completePuzzle(puzzleId, def, now, playerId);
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
   * Rechazo previo al motor: partida terminada o, si la posición del jugador
   * es conocida, objeto fuera de su habitación (servidor autoritativo).
   */
  private rejectWorldAction(objectId: string, playerId: string): RoomRejection | undefined {
    if (this.ended) return "game_over";
    const position = this.positions.get(playerId);
    const object = this.objectsById.get(objectId);
    if (position && object && object.roomId !== position.roomId) return "wrong_room";
    return undefined;
  }

  private placePlayer(playerId: string, position: RoomPlayerPosition, now: number): RoomMoveResult {
    this.addPlayer(playerId);
    const previous = this.positions.get(playerId);
    this.positions.set(playerId, { ...position });
    const runtime = this.engine.state.players[playerId]!;
    runtime.position = { x: position.x, y: position.y };

    const results: EngineResult[] = [];
    const enteredRoom = previous?.roomId !== position.roomId;
    if (enteredRoom) {
      results.push(
        this.dispatch({ type: "on_enter_room", roomId: position.roomId, playerId }, now),
      );
    }
    runtime.roomId = position.roomId;

    const plates = this.syncStandingPlates(now, playerId, results);
    return { outcome: "moved", enteredRoom, engine: mergeResults(now, results), plates };
  }

  /**
   * Placas en modo `stand`: una placa está activa mientras **algún** jugador
   * esté encima. Se recalcula tras cada movimiento.
   */
  private syncStandingPlates(
    now: number,
    actor: string,
    results: EngineResult[],
  ): RoomMoveResult["plates"] {
    const changed: RoomMoveResult["plates"] = [];
    for (const def of this.puzzlesOfType("simultaneous_plates")) {
      if (def.holdMode !== "stand") continue;
      const state = this.templates.simultaneous_plates.get(def.id)!;
      if (state.state === "solved" || state.state === "locked") continue;
      for (const plate of def.plates) {
        const occupant = [...this.positions.entries()].find(
          ([, position]) => position.roomId === def.roomId && isOnCell(position, plate.x, plate.y),
        );
        const runtime = this.templates.simultaneous_plates.get(def.id)!.plates[plate.objectId];
        if (!runtime || runtime.bridged) continue;
        const shouldBeActive = occupant !== undefined;
        if (runtime.active === shouldBeActive) continue;
        const applied = this.applyPlate(
          def.id,
          plate.objectId,
          shouldBeActive,
          now,
          occupant?.[0] ?? actor,
        );
        changed.push({ puzzleId: def.id, plateObjectId: plate.objectId, outcome: applied.outcome });
        if (applied.engine) results.push(applied.engine);
        if (applied.outcome === "solved") break;
      }
    }
    return changed;
  }

  private applyPlate(
    puzzleId: string,
    plateObjectId: string,
    active: boolean,
    now: number,
    playerId: string,
  ): RoomPuzzleActionResult<PlateOutcome> {
    const def = this.definition(puzzleId, "simultaneous_plates");
    const result = setPlateActive(
      this.templates.simultaneous_plates.get(puzzleId)!,
      def,
      plateObjectId,
      active,
      now,
      playerId,
    );
    return this.settlePlates(puzzleId, result.outcome, result.state, now, playerId);
  }

  private placePlatesBridge(
    puzzleId: string,
    plateObjectId: string,
    now: number,
    playerId: string,
  ): RoomPuzzleActionResult<PlateOutcome> {
    const def = this.definition(puzzleId, "simultaneous_plates");
    const result = placeSoloBridge(
      this.templates.simultaneous_plates.get(puzzleId)!,
      def,
      now,
      plateObjectId,
      playerId,
    );
    const settled = this.settlePlates(puzzleId, result.outcome, result.state, now, playerId);
    if (settled.outcome === "solved") return settled;
    // Con el puente puesto, quizá ya hay alguien de pie en la otra placa.
    const results: EngineResult[] = settled.engine ? [settled.engine] : [];
    this.syncStandingPlates(now, playerId, results);
    return {
      outcome: settled.outcome,
      engine: results.length > 0 ? mergeResults(now, results) : null,
    };
  }

  private settlePlates(
    puzzleId: string,
    outcome: PlateOutcome,
    state: SimultaneousPlatesState,
    now: number,
    playerId: string,
  ): RoomPuzzleActionResult<PlateOutcome> {
    const def = this.definition(puzzleId, "simultaneous_plates");
    const next = outcome === "solved" ? { ...state, solvedBy: playerId } : state;
    this.templates.simultaneous_plates.set(puzzleId, next);
    // Reflejo en el mundo: cada placa pisada/puenteada se hunde (`down`).
    const effects: EngineEffect[] = [];
    for (const plate of def.plates) {
      const object = this.objectsById.get(plate.objectId);
      if (!object || !("down" in object.states) || !("up" in object.states)) continue;
      const runtime = next.plates[plate.objectId];
      const down = next.state === "solved" || runtime?.active === true || runtime?.bridged === true;
      const visual = down ? "down" : "up";
      if (this.engine.state.objectStates[plate.objectId] === visual) continue;
      this.engine.state.objectStates[plate.objectId] = visual;
      effects.push({ type: "set_object_state", objectId: plate.objectId, state: visual });
    }
    this.syncRuntime(puzzleId, next);
    const results: EngineResult[] = [];
    if (effects.length > 0) results.push({ ...emptyResult(now), effects });
    if (outcome === "solved") {
      const solved = this.completePuzzle(puzzleId, def, now, playerId);
      if (solved) results.push(solved);
    }
    return { outcome, engine: results.length > 0 ? mergeResults(now, results) : null };
  }

  private placeSplitClueBridge(puzzleId: string, playerId: string): SplitClueBridgeOutcome {
    const def = this.definition(puzzleId, "split_clue");
    const bridged = placeSplitClueBridge(this.templates.split_clue.get(puzzleId)!, def, playerId);
    this.templates.split_clue.set(puzzleId, bridged.state);
    return bridged.outcome;
  }

  /**
   * Escondite sin plantilla `hidden_key` (p. ej. `barril-espejo`): la primera
   * interacción reparte su `hidingSpot.contains` a quien lo registra y pasa el
   * objeto a `open` si lo declara. Idempotente.
   */
  private emptyHidingSpot(objectId: string, now: number, playerId: string): EngineResult | null {
    const object = this.objectsById.get(objectId);
    const itemId = object?.hidingSpot?.contains;
    if (!object || !itemId || this.emptiedHidingSpots.has(objectId)) return null;
    this.emptiedHidingSpots.add(objectId);
    const results: EngineResult[] = [];
    if ("open" in object.states) {
      this.engine.state.objectStates[objectId] = "open";
      results.push({
        ...emptyResult(now),
        effects: [{ type: "set_object_state", objectId, state: "open" }],
      });
    }
    results.push(this.engine.grantItem(itemId, playerId, now));
    return mergeResults(now, results);
  }

  /**
   * Retira una unidad de `itemId` del inventario de `playerId` (p. ej. el
   * objeto-puente al fijarse). `null` si no lo tenía (no debería pasar: el
   * llamador ya comprobó la posesión antes de actuar). Simétrico a
   * `engine.grantItem`, pero el motor no expone un `consumeItem` público
   * porque solo las reglas (`consume_item`) lo hacen hoy.
   */
  private consumeInventoryItem(
    itemId: string,
    playerId: string,
    now: number,
  ): EngineResult | null {
    const inventory = this.engine.state.inventory[playerId];
    const index = inventory?.indexOf(itemId) ?? -1;
    if (!inventory || index < 0) return null;
    inventory.splice(index, 1);
    return {
      ...emptyResult(now),
      effects: [{ type: "consume_item", itemId, playerId }],
    };
  }

  /** Refleja en el `GameState` el estado de la plantilla (salvo `solved`, que es del host). */
  private syncRuntime(puzzleId: string, template: WithPuzzleState, attempts?: number): void {
    const runtime = this.engine.state.puzzleStates[puzzleId];
    if (!runtime || runtime.state === "solved") return;
    if (template.state !== "solved") runtime.state = template.state;
    if (attempts !== undefined) runtime.attempts = attempts;
  }

  /**
   * Marca un puzzle como resuelto, dispara `on_puzzle_solved` (reglas del
   * fixture: transiciones de objeto, diálogos, flags), otorga sus `grantsItems`
   * a quien lo resolvió, abre las puertas de `unlocks` y desbloquea los puzzles
   * cuyo `requiresSolved` ya se cumple. Idempotente.
   */
  private completePuzzle(
    puzzleId: string,
    def: PuzzleDefinition,
    now: number,
    playerId: string,
  ): EngineResult | null {
    if (this.isPuzzleSolved(puzzleId)) return null;

    this.engine.state.puzzleStates[puzzleId] = {
      state: "solved",
      attempts: this.engine.state.puzzleStates[puzzleId]?.attempts ?? 0,
      solvedAt: now,
      solvedBy: playerId,
    };
    const events: EngineResult[] = [
      this.dispatch({ type: "on_puzzle_solved", puzzleId, playerId }, now),
    ];

    for (const itemId of def.grantsItems) {
      events.push(this.engine.grantItem(itemId, playerId, now));
    }

    const doors: EngineEffect[] = [];
    for (const objectId of def.unlocks) {
      const object = this.objectsById.get(objectId);
      if (!object?.leadsTo) continue;
      if (this.engine.state.objectStates[objectId] === DOOR_OPEN_STATE) continue;
      this.engine.state.objectStates[objectId] = DOOR_OPEN_STATE;
      doors.push({ type: "unlock_door", objectId });
    }
    if (doors.length > 0) events.push({ ...emptyResult(now), effects: doors });

    this.refreshAvailability();
    return mergeResults(now, events);
  }

  /** `locked → available` para los puzzles cuyo `requiresSolved` ya está resuelto. */
  private refreshAvailability(): void {
    for (const puzzle of this.roomPackage.puzzles) {
      const runtime = this.engine.state.puzzleStates[puzzle.id];
      if (runtime?.state !== "locked") continue;
      if (!puzzle.requiresSolved.every((id) => this.isPuzzleSolved(id))) continue;
      runtime.state = "available";
      const states = this.templates[puzzle.type] as unknown as Map<string, WithPuzzleState>;
      const template = states.get(puzzle.id);
      if (template?.state === "locked") states.set(puzzle.id, { ...template, state: "available" });
    }
  }

  private puzzlesOfType<T extends PuzzleDefinition["type"]>(type: T): PuzzleOf<T>[] {
    return this.roomPackage.puzzles.filter((puzzle): puzzle is PuzzleOf<T> => puzzle.type === type);
  }

  private definition<T extends PuzzleDefinition["type"]>(puzzleId: string, type: T): PuzzleOf<T> {
    const def = this.puzzlesById.get(puzzleId);
    if (!def || def.type !== type) {
      throw new Error(`No hay un ${type} con id «${puzzleId}».`);
    }
    return def as PuzzleOf<T>;
  }
}

/** `true` si la posición cae en la celda `(x, y)` (±½ celda). */
function isOnCell(position: { x: number; y: number }, x: number, y: number): boolean {
  return Math.abs(position.x - x) <= 0.5 && Math.abs(position.y - y) <= 0.5;
}

function emptyResult(now: number): EngineResult {
  return { now, fired: [], aborted: [], effects: [], events: [], depthExceeded: false };
}

function dialogIdsOf(result: EngineResult): string[] {
  return result.effects
    .filter(
      (effect): effect is Extract<EngineEffect, { type: "show_dialog" }> =>
        effect.type === "show_dialog",
    )
    .map((effect) => effect.dialogId);
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
