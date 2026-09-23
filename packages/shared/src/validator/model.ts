import type {
  PuzzleDefinition,
  Recipe,
  RoomPackage,
  Rule,
  RuleAction,
  RuleCondition,
  RuleTrigger,
  WorldObject,
} from "../schemas";
import type { RouteStepKind } from "./types";

/**
 * Modelo abstracto de la sala para el test de solvabilidad (specs/22 §2.2).
 *
 * No reutiliza el motor de reglas ni las sesiones: razona a nivel de **equipo**
 * (inventario común, sin posiciones ni tiempo) y con acceso a la solución de
 * cada puzzle, que es lo que el validador necesita. Las semánticas copian las
 * del runtime: prioridad de reglas, `once`, `consumed`, cascadas
 * `on_puzzle_solved` → `grantsItems` → `on_item_collected`, puertas con
 * `lockedBy`/`leadsTo`.
 *
 * El mismo código corre en dos modos sobre la interfaz `ModelState`:
 * - **exacto** (`ExactState`): inventario con cantidades, estados de objeto y
 *   flags con un único valor; lo usa la búsqueda BFS de la ruta crítica.
 * - **relajado** (`RelaxedState`): nada se gasta y los estados/flags acumulan
 *   todos los valores alcanzados. Es el cierre monótono por encadenamiento
 *   hacia delante: sobreaproxima lo alcanzable y alimenta los checks de
 *   huérfanos y dead ends sin explosión de estados.
 */

/** Acciones que no alteran el estado de juego (solo narrativa/presentación). */
const NARRATIVE_ACTIONS = new Set<RuleAction["type"]>([
  "show_dialog",
  "play_sound",
  "spawn_effect",
  "open_panel_puzzle",
  "pause_timer",
  "stop_timer",
]);

/** Profundidad máxima de encadenamiento de eventos (specs/05 §2.1). */
const MAX_CHAIN_DEPTH = 32;

/** Fuente de un ítem: quién lo otorga. */
export interface ItemSource {
  kind: "puzzle" | "recipe" | "rule" | "object";
  id: string;
  /** `true` si puede otorgarlo más de una vez (regla `once: false`). */
  repeatable: boolean;
}

/** Índices precalculados sobre el paquete (inmutables). */
export class RoomIndex {
  readonly pkg: RoomPackage;
  readonly startRoomId: string | undefined;
  readonly roomIds: Set<string>;
  readonly objects = new Map<string, WorldObject>();
  readonly puzzles = new Map<string, PuzzleDefinition>();
  readonly itemIds: Set<string>;
  readonly rules: Rule[];
  /** Puertas: objetos con `leadsTo`. */
  readonly doors: WorldObject[];
  /** Puertas que alguna regla o puzzle abre explícitamente. */
  readonly explicitlyOpenedDoors = new Set<string>();
  /** `hidden_key` por objeto escondite. */
  readonly hiddenKeyByObject = new Map<string, string>();
  readonly itemSources = new Map<string, ItemSource[]>();
  /** Timers con alguna regla `on_timer` (su arranque sí cambia el estado). */
  readonly periodicTimers = new Set<string>();

  constructor(pkg: RoomPackage) {
    this.pkg = pkg;
    this.startRoomId = pkg.map.rooms[0]?.id;
    this.roomIds = new Set(pkg.map.rooms.map((room) => room.id));
    for (const object of pkg.objects) this.objects.set(object.id, object);
    for (const puzzle of pkg.puzzles) this.puzzles.set(puzzle.id, puzzle);
    this.itemIds = new Set(pkg.items.map((item) => item.id));
    this.rules = pkg.rules;
    this.doors = pkg.objects.filter((object) => object.leadsTo !== undefined);

    for (const puzzle of pkg.puzzles) {
      if (puzzle.type === "hidden_key" && puzzle.hidingSpot.objectId !== undefined) {
        this.hiddenKeyByObject.set(puzzle.hidingSpot.objectId, puzzle.id);
      }
      for (const objectId of puzzle.unlocks) this.explicitlyOpenedDoors.add(objectId);
      for (const itemId of puzzleGrants(puzzle)) {
        this.addSource(itemId, { kind: "puzzle", id: puzzle.id, repeatable: false });
      }
      if (puzzle.type === "combine_items") {
        for (const recipe of puzzle.recipes) {
          this.addSource(recipe.output, {
            kind: "recipe",
            id: recipeLabel(recipe),
            repeatable: recipe.consumeInputs,
          });
        }
      }
    }

    for (const rule of pkg.rules) {
      if (rule.trigger.type === "on_timer") this.periodicTimers.add(rule.trigger.timerId);
      for (const action of flattenActions(rule.actions)) {
        if (action.type === "grant_item") {
          this.addSource(action.itemId, { kind: "rule", id: rule.id, repeatable: !rule.once });
        }
        if (action.type === "unlock_door") this.explicitlyOpenedDoors.add(action.objectId);
        if (action.type === "set_object_state" && action.state === "open") {
          this.explicitlyOpenedDoors.add(action.objectId);
        }
      }
    }

    for (const object of pkg.objects) {
      for (const itemId of objectGrants(this, object)) {
        this.addSource(itemId, { kind: "object", id: object.id, repeatable: false });
      }
    }
  }

  private addSource(itemId: string, source: ItemSource): void {
    const list = this.itemSources.get(itemId) ?? [];
    list.push(source);
    this.itemSources.set(itemId, list);
  }

  roomOfObject(objectId: string): string | undefined {
    return this.objects.get(objectId)?.roomId;
  }

  /** Habitación donde "vive" una regla (para preferir pistas cercanas). */
  roomOfRule(rule: Rule): string | undefined {
    const trigger = rule.trigger;
    switch (trigger.type) {
      case "on_interact":
      case "on_use_item":
        return this.roomOfObject(trigger.objectId);
      case "on_puzzle_solved":
        return this.puzzles.get(trigger.puzzleId)?.roomId;
      case "on_enter_room":
        return trigger.roomId;
      default:
        return undefined;
    }
  }
}

/** Ítems que otorga un puzzle al resolverse (`grantsItems` + `keyItemId`). */
export function puzzleGrants(puzzle: PuzzleDefinition): string[] {
  const grants = [...puzzle.grantsItems];
  if (puzzle.type === "hidden_key" && puzzle.keyItemId && !grants.includes(puzzle.keyItemId)) {
    grants.push(puzzle.keyItemId);
  }
  return grants;
}

/**
 * Ítems que otorga un objeto al inspeccionarlo: su `inventory` y, si ningún
 * `hidden_key` lo usa como escondite, su `hidingSpot.contains` (si lo usa, el
 * puzzle es la fuente canónica, igual que en `RoomSession`).
 */
export function objectGrants(index: RoomIndex, object: WorldObject): string[] {
  const grants = [...(object.inventory ?? [])];
  if (object.hidingSpot && !index.hiddenKeyByObject.has(object.id)) {
    grants.push(object.hidingSpot.contains);
  }
  return grants;
}

export function recipeLabel(recipe: Recipe): string {
  return `${recipe.inputs.join("+")}→${recipe.output}`;
}

/** Aplana acciones `delay` (el modelo ignora el tiempo). */
export function flattenActions(actions: readonly RuleAction[]): RuleAction[] {
  const out: RuleAction[] = [];
  for (const action of actions) {
    if (action.type === "delay") out.push(...flattenActions(action.actions));
    else out.push(action);
  }
  return out;
}

/** `true` si la regla solo tiene efectos narrativos (no cambia el estado). */
export function isNarrativeRule(index: RoomIndex, rule: Rule): boolean {
  return flattenActions(rule.actions).every(
    (action) =>
      NARRATIVE_ACTIONS.has(action.type) ||
      (action.type === "start_timer" && !index.periodicTimers.has(action.id)),
  );
}

/** `true` si la regla termina la partida con victoria. */
export function isVictoryRule(rule: Rule): boolean {
  return flattenActions(rule.actions).some(
    (action) => action.type === "end_game" && action.result === "victory",
  );
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

/** Operaciones de estado que usan reglas y movimientos, en modo exacto o relajado. */
export interface ModelState {
  readonly playerCount: number;
  victory: boolean;
  lost: boolean;
  /** `true` si la partida terminó (en modo relajado nunca: se sigue explorando). */
  readonly terminal: boolean;
  itemCount(itemId: string): number;
  heldItems(): string[];
  addItem(itemId: string): void;
  /** Gasta una unidad (en modo relajado no hace nada). */
  consumeItem(itemId: string): void;
  objectStateIs(objectId: string, state: string): boolean;
  setObjectState(objectId: string, state: string): void;
  flagIs(flag: string, value: unknown): boolean;
  setFlag(flag: string, value: boolean | number | string): void;
  isSolved(puzzleId: string): boolean;
  markSolved(puzzleId: string): void;
  hasFired(ruleId: string): boolean;
  markFired(ruleId: string, stateful: boolean): void;
  hasRoom(roomId: string): boolean;
  addRoom(roomId: string): void;
  isUnlocked(objectId: string): boolean;
  unlock(objectId: string): void;
  isApplied(key: string): boolean;
  markApplied(key: string): void;
  timerStarted(timerId: string): boolean;
  startTimer(timerId: string): void;
}

/** Estado exacto (BFS): cantidades reales y un valor por objeto/flag. */
export class ExactState implements ModelState {
  victory = false;
  lost = false;
  get terminal(): boolean {
    return this.victory || this.lost;
  }
  constructor(
    readonly playerCount: number,
    private items = new Map<string, number>(),
    private objectStates = new Map<string, string>(),
    private flags = new Map<string, unknown>(),
    private solved = new Set<string>(),
    /** Reglas `once` con efectos de estado ya disparadas (entran en la clave). */
    private statefulFired = new Set<string>(),
    /** Todas las reglas disparadas (narrativas incluidas; fuera de la clave). */
    private fired = new Set<string>(),
    private rooms = new Set<string>(),
    private unlocked = new Set<string>(),
    private applied = new Set<string>(),
    private timers = new Set<string>(),
  ) {}

  static initial(index: RoomIndex, playerCount: number): ExactState {
    const state = new ExactState(playerCount);
    for (const object of index.pkg.objects) {
      state.objectStates.set(object.id, object.initialState);
    }
    state.flags.set("game_started", true);
    state.flags.set("game_ended", false);
    return state;
  }

  clone(): ExactState {
    const copy = new ExactState(
      this.playerCount,
      new Map(this.items),
      new Map(this.objectStates),
      new Map(this.flags),
      new Set(this.solved),
      new Set(this.statefulFired),
      new Set(this.fired),
      new Set(this.rooms),
      new Set(this.unlocked),
      new Set(this.applied),
      new Set(this.timers),
    );
    copy.victory = this.victory;
    copy.lost = this.lost;
    return copy;
  }

  /** Clave canónica del estado de juego (sin contabilidad narrativa). */
  key(): string {
    const items = [...this.items]
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, count]) => `${id}:${count}`);
    const objects = [...this.objectStates].sort(([a], [b]) => (a < b ? -1 : 1));
    const flags = [...this.flags].sort(([a], [b]) => (a < b ? -1 : 1));
    return JSON.stringify([
      items,
      objects,
      flags,
      [...this.solved].sort(),
      [...this.statefulFired].sort(),
      [...this.rooms].sort(),
      [...this.unlocked].sort(),
      [...this.applied].sort(),
      [...this.timers].sort(),
      this.victory,
      this.lost,
    ]);
  }

  itemCount(itemId: string): number {
    return this.items.get(itemId) ?? 0;
  }
  heldItems(): string[] {
    return [...this.items].filter(([, count]) => count > 0).map(([id]) => id);
  }
  addItem(itemId: string): void {
    this.items.set(itemId, this.itemCount(itemId) + 1);
  }
  consumeItem(itemId: string): void {
    const count = this.itemCount(itemId);
    if (count > 0) this.items.set(itemId, count - 1);
  }
  objectStateIs(objectId: string, state: string): boolean {
    return this.objectStates.get(objectId) === state;
  }
  setObjectState(objectId: string, state: string): void {
    this.objectStates.set(objectId, state);
  }
  flagIs(flag: string, value: unknown): boolean {
    return this.flags.get(flag) === value;
  }
  setFlag(flag: string, value: boolean | number | string): void {
    this.flags.set(flag, value);
  }
  isSolved(puzzleId: string): boolean {
    return this.solved.has(puzzleId);
  }
  markSolved(puzzleId: string): void {
    this.solved.add(puzzleId);
  }
  hasFired(ruleId: string): boolean {
    return this.fired.has(ruleId);
  }
  markFired(ruleId: string, stateful: boolean): void {
    this.fired.add(ruleId);
    if (stateful) this.statefulFired.add(ruleId);
  }
  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }
  addRoom(roomId: string): void {
    this.rooms.add(roomId);
  }
  isUnlocked(objectId: string): boolean {
    return this.unlocked.has(objectId);
  }
  unlock(objectId: string): void {
    this.unlocked.add(objectId);
  }
  isApplied(key: string): boolean {
    return this.applied.has(key);
  }
  markApplied(key: string): void {
    this.applied.add(key);
  }
  timerStarted(timerId: string): boolean {
    return this.timers.has(timerId);
  }
  startTimer(timerId: string): void {
    this.timers.add(timerId);
  }
}

/**
 * Estado relajado (cierre monótono): nada se gasta y cada objeto/flag acumula
 * todos los valores que llega a tener. Lo alcanzable aquí es un superconjunto
 * de lo alcanzable jugando.
 */
export class RelaxedState implements ModelState {
  victory = false;
  lost = false;
  readonly terminal = false;
  readonly items = new Set<string>();
  readonly objectStates = new Map<string, Set<string>>();
  readonly flags = new Map<string, Set<unknown>>();
  readonly solved = new Set<string>();
  readonly fired = new Set<string>();
  readonly rooms = new Set<string>();
  readonly unlocked = new Set<string>();
  readonly applied = new Set<string>();
  readonly timers = new Set<string>();
  /** Contador de hechos nuevos: el cierre itera hasta que deja de crecer. */
  changes = 0;

  constructor(readonly playerCount: number) {}

  static initial(index: RoomIndex, playerCount: number): RelaxedState {
    const state = new RelaxedState(playerCount);
    for (const object of index.pkg.objects) {
      state.objectStates.set(object.id, new Set([object.initialState]));
    }
    state.flags.set("game_started", new Set([true]));
    state.flags.set("game_ended", new Set([false]));
    return state;
  }

  private addTo<T>(set: Set<T>, value: T): void {
    if (!set.has(value)) {
      set.add(value);
      this.changes++;
    }
  }

  itemCount(itemId: string): number {
    return this.items.has(itemId) ? Number.POSITIVE_INFINITY : 0;
  }
  heldItems(): string[] {
    return [...this.items];
  }
  addItem(itemId: string): void {
    this.addTo(this.items, itemId);
  }
  consumeItem(): void {}
  objectStateIs(objectId: string, state: string): boolean {
    return this.objectStates.get(objectId)?.has(state) ?? false;
  }
  setObjectState(objectId: string, state: string): void {
    const set = this.objectStates.get(objectId) ?? new Set<string>();
    this.objectStates.set(objectId, set);
    this.addTo(set, state);
  }
  flagIs(flag: string, value: unknown): boolean {
    return this.flags.get(flag)?.has(value) ?? false;
  }
  setFlag(flag: string, value: boolean | number | string): void {
    const set = this.flags.get(flag) ?? new Set<unknown>();
    this.flags.set(flag, set);
    this.addTo(set, value);
  }
  isSolved(puzzleId: string): boolean {
    return this.solved.has(puzzleId);
  }
  markSolved(puzzleId: string): void {
    this.addTo(this.solved, puzzleId);
  }
  hasFired(ruleId: string): boolean {
    return this.fired.has(ruleId);
  }
  markFired(ruleId: string): void {
    this.addTo(this.fired, ruleId);
  }
  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }
  addRoom(roomId: string): void {
    this.addTo(this.rooms, roomId);
  }
  isUnlocked(objectId: string): boolean {
    return this.unlocked.has(objectId);
  }
  unlock(objectId: string): void {
    this.addTo(this.unlocked, objectId);
  }
  isApplied(key: string): boolean {
    return this.applied.has(key);
  }
  markApplied(key: string): void {
    this.addTo(this.applied, key);
  }
  timerStarted(timerId: string): boolean {
    return this.timers.has(timerId);
  }
  startTimer(timerId: string): void {
    this.addTo(this.timers, timerId);
  }
}

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------

/** Efectos acumulados de un paso (para describir la ruta). */
export interface StepEffects {
  itemsGained: string[];
  itemsConsumed: string[];
  rulesFired: string[];
  puzzlesSolved: string[];
  roomsEntered: string[];
  objectStates: string[];
  flags: string[];
  victory: boolean;
}

export function emptyEffects(): StepEffects {
  return {
    itemsGained: [],
    itemsConsumed: [],
    rulesFired: [],
    puzzlesSolved: [],
    roomsEntered: [],
    objectStates: [],
    flags: [],
    victory: false,
  };
}

function triggerMatches(trigger: RuleTrigger, event: RuleTrigger): boolean {
  if (trigger.type !== event.type) return false;
  switch (trigger.type) {
    case "on_interact":
      return event.type === "on_interact" && trigger.objectId === event.objectId;
    case "on_use_item":
      return (
        event.type === "on_use_item" &&
        trigger.objectId === event.objectId &&
        trigger.itemId === event.itemId
      );
    case "on_enter_room":
      return event.type === "on_enter_room" && trigger.roomId === event.roomId;
    case "on_puzzle_solved":
      return event.type === "on_puzzle_solved" && trigger.puzzleId === event.puzzleId;
    case "on_item_collected":
      return event.type === "on_item_collected" && trigger.itemId === event.itemId;
    case "on_timer":
      return event.type === "on_timer" && trigger.timerId === event.timerId;
    case "on_all_players_in_zone":
      return event.type === "on_all_players_in_zone";
    case "on_game_start":
      return true;
    default:
      // `on_timer_end` / `on_time_remaining_below`: el modelo no simula el
      // tiempo (la victoria no puede depender de que se agote).
      return false;
  }
}

/** Estado lógico de un puzzle, como lo ven las condiciones `puzzle_state_is`. */
export function puzzleStateOf(index: RoomIndex, state: ModelState, puzzleId: string): string {
  if (state.isSolved(puzzleId)) return "solved";
  const puzzle = index.puzzles.get(puzzleId);
  if (!puzzle) return "locked";
  return puzzle.requiresSolved.every((id) => state.isSolved(id)) ? "available" : "locked";
}

export function conditionHolds(
  index: RoomIndex,
  state: ModelState,
  condition: RuleCondition,
): boolean {
  switch (condition.type) {
    case "item_in_inventory":
      return state.itemCount(condition.itemId) > 0;
    case "puzzle_state_is": {
      const current = puzzleStateOf(index, state, condition.puzzleId);
      if (state instanceof RelaxedState) {
        // En el cierre, un puzzle pasa por locked → available → solved.
        const puzzle = index.puzzles.get(condition.puzzleId);
        const reached = new Set<string>([current]);
        if (puzzle && puzzle.requiresSolved.length > 0) reached.add("locked");
        if (current === "solved") reached.add("available");
        if (condition.state === "in_progress") return reached.has("available");
        return reached.has(condition.state);
      }
      if (condition.state === "in_progress") return current === "available";
      return current === condition.state;
    }
    case "object_state_is":
      return state.objectStateIs(condition.objectId, condition.state);
    case "flag_is":
      return state.flagIs(condition.flag, condition.value);
    case "player_count_min":
      return state.playerCount >= condition.n;
    case "player_count_max":
      return state.playerCount <= condition.n;
    case "time_remaining_below":
      return false;
  }
}

function applyActions(
  index: RoomIndex,
  state: ModelState,
  actions: readonly RuleAction[],
  effects: StepEffects,
  queue: RuleTrigger[],
): void {
  for (const action of flattenActions(actions)) {
    switch (action.type) {
      case "set_object_state":
        state.setObjectState(action.objectId, action.state);
        effects.objectStates.push(`${action.objectId}: ${action.state}`);
        break;
      case "unlock_door":
        state.unlock(action.objectId);
        effects.objectStates.push(`${action.objectId}: abierta`);
        break;
      case "grant_item":
        state.addItem(action.itemId);
        effects.itemsGained.push(action.itemId);
        queue.push({ type: "on_item_collected", itemId: action.itemId });
        break;
      case "consume_item":
        if (state.itemCount(action.itemId) > 0) {
          state.consumeItem(action.itemId);
          effects.itemsConsumed.push(action.itemId);
        }
        break;
      case "set_flag":
        state.setFlag(action.flag, action.value);
        effects.flags.push(`${action.flag}=${String(action.value)}`);
        break;
      case "start_timer":
        state.startTimer(action.id);
        break;
      case "end_game":
        if (action.result === "victory") {
          state.victory = true;
          effects.victory = true;
        } else {
          state.lost = true;
        }
        break;
      default:
        break;
    }
  }
}

/**
 * Despacha un evento y su cascada (como `createEngine().dispatch`): reglas por
 * prioridad descendente y orden de declaración, condiciones evaluadas en el
 * momento de disparar y `consumed` gastando el ítem.
 */
export function dispatchEvent(
  index: RoomIndex,
  state: ModelState,
  event: RuleTrigger,
  effects: StepEffects,
): void {
  const queue: RuleTrigger[] = [event];
  let depth = 0;
  while (queue.length > 0 && depth < MAX_CHAIN_DEPTH * 8) {
    depth++;
    const current = queue.shift()!;
    const matching = index.rules
      .map((rule, order) => ({ rule, order }))
      .filter(({ rule }) => triggerMatches(rule.trigger, current))
      .sort((a, b) => b.rule.priority - a.rule.priority || a.order - b.order);
    for (const { rule } of matching) {
      if (state.terminal) return;
      if (rule.once && state.hasFired(rule.id)) continue;
      if (!rule.conditions.every((condition) => conditionHolds(index, state, condition))) {
        continue;
      }
      for (const condition of rule.conditions) {
        if (condition.type === "item_in_inventory" && condition.consumed === true) {
          state.consumeItem(condition.itemId);
          effects.itemsConsumed.push(condition.itemId);
        }
      }
      state.markFired(rule.id, rule.once && !isNarrativeRule(index, rule));
      effects.rulesFired.push(rule.id);
      applyActions(index, state, rule.actions, effects, queue);
    }
  }
}

// ---------------------------------------------------------------------------
// Movimientos
// ---------------------------------------------------------------------------

/** Acción de jugador (un paso de la ruta). */
export type Move =
  | { kind: "solve_puzzle"; puzzleId: string }
  | { kind: "combine"; puzzleId: string; recipeIndex: number }
  | { kind: "use_item"; objectId: string; itemId: string }
  | { kind: "interact"; objectId: string }
  | { kind: "enter_room"; roomId: string; doorId: string }
  | { kind: "zone"; ruleId: string }
  | { kind: "timer"; timerId: string };

export type MoveKind = RouteStepKind;

/**
 * Oráculo de un puzzle en el estado dado: `null` si se puede resolver ahora, o
 * la lista de precondiciones que faltan (mensajes accionables).
 */
export type PuzzleOracle = (
  puzzle: PuzzleDefinition,
  state: ModelState,
) => { ok: true; consumes: string[] } | { ok: false; reasons: string[] };

export function objectAccessible(index: RoomIndex, state: ModelState, objectId: string): boolean {
  const object = index.objects.get(objectId);
  return object !== undefined && object.interactable && state.hasRoom(object.roomId);
}

/**
 * `true` si la puerta deja pasar en este estado. Con `lockedBy`, manda su
 * puzzle (lectura conservadora: un `unlocks` o una regla de otro puzzle no
 * saltan el cerrojo declarado). Sin `lockedBy`, está abierta salvo que alguna
 * regla o puzzle la abra explícitamente; entonces hace falta que ocurra.
 */
export function doorPassable(index: RoomIndex, state: ModelState, door: WorldObject): boolean {
  if (door.lockedBy !== undefined) return state.isSolved(door.lockedBy);
  if (state.isUnlocked(door.id) || state.objectStateIs(door.id, "open")) return true;
  return !index.explicitlyOpenedDoors.has(door.id);
}

/** Marca un puzzle como resuelto y aplica su cascada (on_puzzle_solved → grants). */
export function completePuzzle(
  index: RoomIndex,
  state: ModelState,
  puzzle: PuzzleDefinition,
  effects: StepEffects,
): void {
  if (state.isSolved(puzzle.id)) return;
  state.markSolved(puzzle.id);
  effects.puzzlesSolved.push(puzzle.id);
  for (const objectId of puzzle.unlocks) {
    state.unlock(objectId);
    effects.objectStates.push(`${objectId}: desbloqueado`);
  }
  dispatchEvent(index, state, { type: "on_puzzle_solved", puzzleId: puzzle.id }, effects);
  for (const itemId of puzzleGrants(puzzle)) {
    state.addItem(itemId);
    effects.itemsGained.push(itemId);
    dispatchEvent(index, state, { type: "on_item_collected", itemId }, effects);
  }
}

/** Estado tras `on_game_start` y la entrada en la habitación inicial. */
export function startGame(index: RoomIndex, state: ModelState): void {
  const effects = emptyEffects();
  dispatchEvent(index, state, { type: "on_game_start" }, effects);
  if (index.startRoomId !== undefined) {
    state.addRoom(index.startRoomId);
    dispatchEvent(index, state, { type: "on_enter_room", roomId: index.startRoomId }, effects);
  }
}

/** Movimientos candidatos en el estado (orden determinista). */
export function candidateMoves(index: RoomIndex, state: ModelState): Move[] {
  const moves: Move[] = [];
  if (state.terminal) return moves;

  for (const puzzle of index.pkg.puzzles) {
    if (state.isSolved(puzzle.id)) continue;
    if (puzzle.type === "combine_items") {
      puzzle.recipes.forEach((_, recipeIndex) =>
        moves.push({ kind: "combine", puzzleId: puzzle.id, recipeIndex }),
      );
    } else {
      moves.push({ kind: "solve_puzzle", puzzleId: puzzle.id });
    }
  }

  const seenUse = new Set<string>();
  const seenInteract = new Set<string>();
  for (const rule of index.rules) {
    const trigger = rule.trigger;
    if (trigger.type === "on_use_item") {
      const key = `${trigger.objectId}|${trigger.itemId}`;
      if (seenUse.has(key)) continue;
      seenUse.add(key);
      moves.push({ kind: "use_item", objectId: trigger.objectId, itemId: trigger.itemId });
    } else if (trigger.type === "on_interact") {
      if (seenInteract.has(trigger.objectId)) continue;
      seenInteract.add(trigger.objectId);
      moves.push({ kind: "interact", objectId: trigger.objectId });
    } else if (trigger.type === "on_all_players_in_zone") {
      moves.push({ kind: "zone", ruleId: rule.id });
    }
  }
  for (const object of index.pkg.objects) {
    if (seenInteract.has(object.id) || index.hiddenKeyByObject.has(object.id)) continue;
    if (objectGrants(index, object).length > 0) {
      seenInteract.add(object.id);
      moves.push({ kind: "interact", objectId: object.id });
    }
  }

  for (const door of index.doors) {
    const target = door.leadsTo!;
    if (!doorPassable(index, state, door)) continue;
    if (state.hasRoom(door.roomId) && !state.hasRoom(target)) {
      moves.push({ kind: "enter_room", roomId: target, doorId: door.id });
    } else if (state.hasRoom(target) && !state.hasRoom(door.roomId)) {
      moves.push({ kind: "enter_room", roomId: door.roomId, doorId: door.id });
    }
  }

  for (const timerId of index.periodicTimers) {
    if (state.timerStarted(timerId)) moves.push({ kind: "timer", timerId });
  }
  return moves;
}

/**
 * Aplica un movimiento. Devuelve `null` si no es aplicable en el estado (el
 * estado puede haber quedado a medias: el llamador trabaja sobre una copia).
 */
export function applyMove(
  index: RoomIndex,
  state: ModelState,
  move: Move,
  oracle: PuzzleOracle,
): StepEffects | null {
  const effects = emptyEffects();
  switch (move.kind) {
    case "solve_puzzle": {
      const puzzle = index.puzzles.get(move.puzzleId);
      if (!puzzle || state.isSolved(puzzle.id)) return null;
      const verdict = oracle(puzzle, state);
      if (!verdict.ok) return null;
      for (const itemId of verdict.consumes) {
        state.consumeItem(itemId);
        effects.itemsConsumed.push(itemId);
      }
      if (puzzle.type === "hidden_key" && puzzle.hidingSpot.objectId !== undefined) {
        dispatchEvent(
          index,
          state,
          { type: "on_interact", objectId: puzzle.hidingSpot.objectId },
          effects,
        );
      }
      completePuzzle(index, state, puzzle, effects);
      return effects;
    }
    case "combine": {
      const puzzle = index.puzzles.get(move.puzzleId);
      if (!puzzle || puzzle.type !== "combine_items" || state.isSolved(puzzle.id)) return null;
      const verdict = oracle(puzzle, state);
      if (!verdict.ok) return null;
      const recipe = puzzle.recipes[move.recipeIndex];
      if (!recipe) return null;
      const key = `${puzzle.id}#${move.recipeIndex}`;
      if (!recipe.consumeInputs && state.isApplied(key)) return null;
      if (!recipe.inputs.every((itemId) => state.itemCount(itemId) > 0)) return null;
      if (recipe.consumeInputs) {
        for (const itemId of recipe.inputs) {
          state.consumeItem(itemId);
          effects.itemsConsumed.push(itemId);
        }
      }
      state.markApplied(key);
      state.addItem(recipe.output);
      effects.itemsGained.push(recipe.output);
      dispatchEvent(index, state, { type: "on_item_collected", itemId: recipe.output }, effects);
      if (puzzle.recipes.every((_, i) => state.isApplied(`${puzzle.id}#${i}`))) {
        completePuzzle(index, state, puzzle, effects);
      }
      return effects;
    }
    case "use_item": {
      if (!objectAccessible(index, state, move.objectId)) return null;
      if (state.itemCount(move.itemId) <= 0) return null;
      dispatchEvent(
        index,
        state,
        { type: "on_use_item", objectId: move.objectId, itemId: move.itemId },
        effects,
      );
      return effects.rulesFired.length > 0 ? effects : null;
    }
    case "interact": {
      if (!objectAccessible(index, state, move.objectId)) return null;
      dispatchEvent(index, state, { type: "on_interact", objectId: move.objectId }, effects);
      const object = index.objects.get(move.objectId)!;
      const grantKey = `object:${object.id}`;
      const grants = objectGrants(index, object);
      if (grants.length > 0 && !state.isApplied(grantKey)) {
        state.markApplied(grantKey);
        for (const itemId of grants) {
          state.addItem(itemId);
          effects.itemsGained.push(itemId);
          dispatchEvent(index, state, { type: "on_item_collected", itemId }, effects);
        }
      }
      return effects;
    }
    case "enter_room": {
      const door = index.objects.get(move.doorId);
      if (!door || !doorPassable(index, state, door) || state.hasRoom(move.roomId)) return null;
      state.addRoom(move.roomId);
      effects.roomsEntered.push(move.roomId);
      dispatchEvent(index, state, { type: "on_enter_room", roomId: move.roomId }, effects);
      return effects;
    }
    case "zone": {
      const rule = index.rules.find((candidate) => candidate.id === move.ruleId);
      if (!rule || rule.trigger.type !== "on_all_players_in_zone") return null;
      const zone = rule.trigger.zone;
      const reachable =
        typeof zone === "string" ? state.hasRoom(zone) || !index.roomIds.has(zone) : true;
      if (!reachable) return null;
      dispatchEvent(index, state, rule.trigger, effects);
      return effects;
    }
    case "timer": {
      if (!state.timerStarted(move.timerId)) return null;
      dispatchEvent(index, state, { type: "on_timer", timerId: move.timerId }, effects);
      return effects;
    }
  }
}
