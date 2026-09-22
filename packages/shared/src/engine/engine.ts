import type { FlagValue, Rule, RuleAction, RuleCondition, RuleTrigger } from "../schemas/rules";
import type {
  DeferredAction,
  Engine,
  EngineEffect,
  EngineOptions,
  EngineResult,
  GameEvent,
  GameState,
  GrantTarget,
  Zone,
} from "./types";

/** Error interno que aborta una regla entera (transaccionalidad). */
export class EngineActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineActionError";
  }
}

interface ActionContext {
  now: number;
  playerId: string;
  ruleId: string;
  event: GameEvent;
}

interface ActionOutput {
  effects: EngineEffect[];
  emitted: GameEvent[];
}

/** Reloj lógico y profundidad de encadenamiento por defecto. */
const DEFAULT_MAX_CHAIN_DEPTH = 32;
const DEFAULT_PLAYER_ID = "p1";

/** Clon profundo serializable del estado (transactionalidad). */
export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function eventKey(event: GameEvent): string {
  return `${event.type}:${JSON.stringify(event)}`;
}

function emptyResult(now: number): EngineResult {
  return { now, fired: [], aborted: [], effects: [], events: [], depthExceeded: false };
}

function addItem(state: GameState, playerId: string, itemId: string): void {
  const inventory = (state.inventory[playerId] ??= []);
  if (!inventory.includes(itemId)) inventory.push(itemId);
}

function removeItem(state: GameState, playerId: string, itemId: string): void {
  const inventory = state.inventory[playerId];
  if (!inventory) return;
  const index = inventory.indexOf(itemId);
  if (index >= 0) inventory.splice(index, 1);
}

function findItemHolder(state: GameState, itemId: string, preferred?: string): string | undefined {
  if (preferred !== undefined && state.inventory[preferred]?.includes(itemId)) {
    return preferred;
  }
  for (const playerId of Object.keys(state.inventory)) {
    if (state.inventory[playerId]?.includes(itemId)) return playerId;
  }
  return undefined;
}

function playerCount(state: GameState): number {
  const ids = new Set([...Object.keys(state.players), ...Object.keys(state.inventory)]);
  return ids.size;
}

function remainingSeconds(state: GameState, now: number): number | undefined {
  if (state.timeLimitSec === undefined) return undefined;
  return state.timeLimitSec - (now - state.startedAt) / 1000;
}

function flagEquals(actual: FlagValue | undefined, expected: FlagValue): boolean {
  return actual === expected;
}

function zoneEquals(a: Zone | undefined, b: Zone | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function triggerMatches(trigger: RuleTrigger, event: GameEvent): boolean {
  switch (trigger.type) {
    case "on_game_start":
      return event.type === "on_game_start";
    case "on_interact":
      return event.type === "on_interact" && event.objectId === trigger.objectId;
    case "on_enter_room":
      return event.type === "on_enter_room" && event.roomId === trigger.roomId;
    case "on_puzzle_solved":
      return event.type === "on_puzzle_solved" && event.puzzleId === trigger.puzzleId;
    case "on_item_collected":
      return event.type === "on_item_collected" && event.itemId === trigger.itemId;
    case "on_timer":
      return event.type === "on_timer" && event.timerId === trigger.timerId;
    case "on_timer_end":
      return event.type === "on_timer_end" && event.timerId === trigger.timerId;
    case "on_time_remaining_below":
      return event.type === "on_time_remaining_below" && event.seconds === trigger.seconds;
    case "on_all_players_in_zone":
      return event.type === "on_all_players_in_zone" && zoneEquals(event.zone, trigger.zone);
  }
}

/**
 * Motor de reglas declarativo (specs/05). Librería pura y determinista: no usa
 * red, base de datos ni `setTimeout`; el tiempo lógico entra por `dispatch` y
 * `tick`. Consume las reglas del contrato `RoomPackage` (0.6).
 */
class RuleEngine {
  private current: GameState;
  private readonly orderedRules: Rule[];
  private readonly maxChainDepth: number;
  private readonly defaultPlayerId: string;
  private now: number;

  constructor(state: GameState, rules: Rule[], options: EngineOptions = {}) {
    this.current = state;
    this.orderedRules = rules
      .map((rule, index) => ({ rule, index }))
      .sort((a, b) => b.rule.priority - a.rule.priority || a.index - b.index)
      .map(({ rule }) => rule);
    this.maxChainDepth = options.maxChainDepth ?? DEFAULT_MAX_CHAIN_DEPTH;
    this.defaultPlayerId = options.playerId ?? DEFAULT_PLAYER_ID;
    this.now = options.now ?? state.lastTickAt ?? 0;

    for (const playerId of [...(options.players ?? []), this.defaultPlayerId]) {
      this.current.players[playerId] ??= {};
      this.current.inventory[playerId] ??= [];
    }
  }

  get state(): GameState {
    return this.current;
  }

  snapshot(): GameState {
    return cloneState(this.current);
  }

  firedCount(ruleId: string): number {
    return this.current.ruleRuns[ruleId]?.count ?? 0;
  }

  dispatch(event: GameEvent, now?: number): EngineResult {
    if (now !== undefined) this.now = now;
    const result = emptyResult(this.now);
    if (this.current.result) return result;
    this.primeEvent(event);
    this.evaluateEvent(event, 0, result);
    return result;
  }

  tick(now: number): EngineResult {
    this.now = now;
    const result = emptyResult(now);
    if (this.current.result) {
      this.current.lastTickAt = now;
      return result;
    }

    const last = this.current.lastTickAt ?? now;
    const deltaMs = Math.max(0, now - last);

    const timerEvents = this.advanceTimers(deltaMs);

    const due: DeferredAction[] = [];
    const future: DeferredAction[] = [];
    for (const entry of this.current.deferred) {
      (entry.dueAt <= now ? due : future).push(entry);
    }
    due.sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id));
    this.current.deferred = future;

    const deferredEvents: GameEvent[] = [];
    for (const entry of due) {
      this.runDeferred(entry, result, deferredEvents);
      if (this.current.result) break;
    }

    const remaining = remainingSeconds(this.current, now);
    if (remaining !== undefined) {
      this.current.flags.time_remaining = remaining;
    }
    const thresholdEvents = this.collectThresholdEvents(now);

    const events = [...timerEvents, ...deferredEvents, ...thresholdEvents];
    for (const event of events) {
      if (this.current.result) break;
      this.evaluateEvent(event, 0, result);
    }

    this.current.lastTickAt = now;
    return result;
  }

  grantItem(itemId: string, to: GrantTarget = "interactor", now?: number): EngineResult {
    if (now !== undefined) this.now = now;
    const result = emptyResult(this.now);
    if (this.current.result) return result;

    const ctx: ActionContext = {
      now: this.now,
      playerId: this.defaultPlayerId,
      ruleId: "__grant_item__",
      event: { type: "on_item_collected", itemId },
    };
    const draft = cloneState(this.current);
    const out: ActionOutput = { effects: [], emitted: [] };
    for (const playerId of this.recipients(draft, to, ctx)) {
      addItem(draft, playerId, itemId);
      out.effects.push({ type: "grant_item", itemId, playerId });
    }
    out.emitted.push({
      type: "on_item_collected",
      itemId,
      playerId: to === "all" ? undefined : this.eventPlayer(to, ctx),
    });

    this.current = draft;
    result.effects.push(...out.effects);
    for (const event of out.emitted) {
      this.evaluateEvent(event, 0, result);
    }
    return result;
  }

  private primeEvent(event: GameEvent): void {
    if (event.type === "on_game_start") {
      if (!this.current.flags.game_started) this.current.startedAt = this.now;
      this.current.flags.game_started = true;
      if (this.current.phase !== "ended") this.current.phase = "playing";
    }
    if (event.type === "on_enter_room" && event.playerId) {
      const player = (this.current.players[event.playerId] ??= {});
      player.roomId = event.roomId;
    }
  }

  private evaluateEvent(event: GameEvent, depth: number, result: EngineResult): void {
    result.events.push(event);

    if (event.type === "on_interact" && event.playerId) {
      this.current.players[event.playerId] ??= {};
    }

    const candidates = this.orderedRules.filter(
      (rule) => !this.isOnceFired(rule) && triggerMatches(rule.trigger, event),
    );
    const emitted: GameEvent[] = [];

    for (const rule of candidates) {
      if (this.current.result) break;
      const ctx: ActionContext = {
        now: this.now,
        playerId: event.playerId ?? this.defaultPlayerId,
        ruleId: rule.id,
        event,
      };
      if (!this.conditionsHold(rule.conditions, ctx)) continue;

      const draft = cloneState(this.current);
      const out: ActionOutput = { effects: [], emitted: [] };
      try {
        this.applyActions(draft, rule.actions, ctx, out, "0");
        this.consumeConditionItems(draft, rule.conditions, ctx);
      } catch (error) {
        result.aborted.push({
          ruleId: rule.id,
          at: this.now,
          event,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      this.current = draft;
      result.effects.push(...out.effects);
      for (const innerEvent of out.emitted) {
        emitted.push(innerEvent);
        result.events.push(innerEvent);
      }
      this.current.ruleRuns[rule.id] = {
        firedAt: this.now,
        count: (this.current.ruleRuns[rule.id]?.count ?? 0) + 1,
        lastEventType: event.type,
      };
      result.fired.push({
        ruleId: rule.id,
        at: this.now,
        event,
        effectCount: out.effects.length,
      });
    }

    if (emitted.length > 0) {
      if (depth + 1 > this.maxChainDepth) {
        result.depthExceeded = true;
      } else {
        for (const innerEvent of emitted) {
          if (this.current.result) break;
          this.evaluateEvent(innerEvent, depth + 1, result);
        }
      }
    }
  }

  private isOnceFired(rule: Rule): boolean {
    return rule.once !== false && (this.current.ruleRuns[rule.id]?.count ?? 0) > 0;
  }

  private conditionsHold(conditions: RuleCondition[], ctx: ActionContext): boolean {
    return conditions.every((condition) => this.conditionHolds(condition, ctx));
  }

  private conditionHolds(condition: RuleCondition, ctx: ActionContext): boolean {
    switch (condition.type) {
      // Inventario cooperativo: vale que el ítem lo tenga cualquier jugador.
      case "item_in_inventory":
        return findItemHolder(this.current, condition.itemId) !== undefined;
      case "puzzle_state_is":
        return this.current.puzzleStates[condition.puzzleId]?.state === condition.state;
      case "object_state_is":
        return this.current.objectStates[condition.objectId] === condition.state;
      case "flag_is":
        return flagEquals(this.current.flags[condition.flag], condition.value);
      case "player_count_min":
        return playerCount(this.current) >= condition.n;
      case "player_count_max":
        return playerCount(this.current) <= condition.n;
      case "time_remaining_below": {
        const remaining = remainingSeconds(this.current, ctx.now);
        return remaining !== undefined && remaining <= condition.seconds;
      }
    }
  }

  /**
   * Consume implícitamente los ítems de las condiciones `item_in_inventory`
   * con `consumed: true` (patrón del Rey Aldric: la llave/torch se gasta al
   * usarse). Es best-effort: si una acción ya lo consumió, no falla.
   */
  private consumeConditionItems(
    state: GameState,
    conditions: RuleCondition[],
    ctx: ActionContext,
  ): void {
    const seen = new Set<string>();
    for (const condition of conditions) {
      if (condition.type !== "item_in_inventory" || condition.consumed !== true) continue;
      if (seen.has(condition.itemId)) continue;
      seen.add(condition.itemId);
      const holder = findItemHolder(state, condition.itemId, ctx.playerId);
      if (holder !== undefined) removeItem(state, holder, condition.itemId);
    }
  }

  private applyActions(
    state: GameState,
    actions: RuleAction[],
    ctx: ActionContext,
    out: ActionOutput,
    path: string,
  ): void {
    actions.forEach((action, index) => {
      this.applyAction(state, action, ctx, out, `${path}.${index}`);
    });
  }

  private applyAction(
    state: GameState,
    action: RuleAction,
    ctx: ActionContext,
    out: ActionOutput,
    path: string,
  ): void {
    switch (action.type) {
      case "set_object_state":
        state.objectStates[action.objectId] = action.state;
        out.effects.push({
          type: "set_object_state",
          objectId: action.objectId,
          state: action.state,
        });
        return;
      case "unlock_door":
        state.objectStates[action.objectId] = "open";
        out.effects.push({ type: "unlock_door", objectId: action.objectId });
        return;
      case "grant_item": {
        for (const playerId of this.recipients(state, action.to, ctx)) {
          addItem(state, playerId, action.itemId);
          out.effects.push({ type: "grant_item", itemId: action.itemId, playerId });
        }
        out.emitted.push({
          type: "on_item_collected",
          itemId: action.itemId,
          playerId: action.to === "all" ? undefined : this.eventPlayer(action.to, ctx),
        });
        return;
      }
      case "consume_item": {
        const holder = findItemHolder(state, action.itemId, ctx.playerId);
        if (holder === undefined) {
          throw new EngineActionError(
            `no se puede consumir '${action.itemId}': no está en ningún inventario`,
          );
        }
        removeItem(state, holder, action.itemId);
        out.effects.push({ type: "consume_item", itemId: action.itemId, playerId: holder });
        return;
      }
      case "show_dialog":
        out.effects.push({ type: "show_dialog", dialogId: action.dialogId });
        return;
      case "play_sound":
        out.effects.push({ type: "play_sound", soundId: action.soundId });
        return;
      case "spawn_effect":
        out.effects.push({
          type: "spawn_effect",
          effectId: action.effectId,
          position: action.position,
        });
        return;
      case "open_panel_puzzle":
        out.effects.push({ type: "open_panel_puzzle", puzzleId: action.puzzleId });
        return;
      case "set_flag":
        state.flags[action.flag] = action.value;
        out.effects.push({ type: "set_flag", flag: action.flag, value: action.value });
        return;
      case "reveal_number":
        state.reveals[action.objectId] = action.value;
        out.effects.push({ type: "reveal_number", objectId: action.objectId, value: action.value });
        return;
      case "start_timer": {
        const duration = action.durationSec ?? null;
        state.timers[action.id] = {
          id: action.id,
          durationSec: duration,
          remainingSec: duration,
          running: true,
          periodic: this.timerHasOnTimerListener(action.id),
          startedAt: ctx.now,
          elapsedMs: 0,
        };
        out.effects.push({ type: "start_timer", id: action.id, durationSec: action.durationSec });
        return;
      }
      case "pause_timer": {
        const timer = state.timers[action.id];
        if (timer) {
          timer.running = false;
          timer.pausedAt = ctx.now;
        }
        out.effects.push({ type: "pause_timer", id: action.id });
        return;
      }
      case "stop_timer": {
        const timer = state.timers[action.id];
        if (timer) {
          timer.running = false;
          timer.stoppedAt = ctx.now;
        }
        out.effects.push({ type: "stop_timer", id: action.id });
        return;
      }
      case "delay": {
        const dueAt = ctx.now + Math.max(0, action.seconds) * 1000;
        const id = `${ctx.ruleId}:${path}:${ctx.now}:${eventKey(ctx.event)}`;
        if (!state.deferred.some((entry) => entry.id === id)) {
          state.deferred.push({
            id,
            ruleId: ctx.ruleId,
            dueAt,
            actions: action.actions,
            event: ctx.event,
          });
        }
        return;
      }
      case "end_game":
        state.result = action.result;
        state.endedAt = ctx.now;
        state.phase = "ended";
        state.flags.game_ended = true;
        for (const timer of Object.values(state.timers)) timer.running = false;
        out.effects.push({ type: "end_game", result: action.result });
        return;
    }
  }

  private recipients(state: GameState, to: GrantTarget, ctx: ActionContext): string[] {
    if (to === "all") {
      const ids = new Set([...Object.keys(state.inventory), ...Object.keys(state.players)]);
      if (ctx.playerId) ids.add(ctx.playerId);
      return [...ids];
    }
    if (to === "interactor") return [ctx.playerId];
    return [to];
  }

  private eventPlayer(to: GrantTarget, ctx: ActionContext): string | undefined {
    if (to === "all") return undefined;
    if (to === "interactor") return ctx.playerId;
    return to;
  }

  private timerHasOnTimerListener(timerId: string): boolean {
    return this.orderedRules.some(
      (rule) => rule.trigger.type === "on_timer" && rule.trigger.timerId === timerId,
    );
  }

  private advanceTimers(deltaMs: number): GameEvent[] {
    const events: GameEvent[] = [];
    if (deltaMs <= 0) return events;
    for (const id of Object.keys(this.current.timers).sort()) {
      const timer = this.current.timers[id];
      if (!timer || !timer.running) continue;
      if (timer.durationSec === null || timer.remainingSec === null) continue;
      timer.elapsedMs += deltaMs;
      timer.remainingSec -= deltaMs / 1000;
      while (timer.remainingSec <= 0) {
        if (timer.periodic && timer.durationSec > 0) {
          events.push({ type: "on_timer", timerId: id });
          timer.remainingSec += timer.durationSec;
        } else {
          timer.remainingSec = 0;
          timer.running = false;
          events.push({ type: "on_timer_end", timerId: id });
          break;
        }
      }
    }
    return events;
  }

  private collectThresholdEvents(now: number): GameEvent[] {
    const remaining = remainingSeconds(this.current, now);
    if (remaining === undefined) return [];
    const events: GameEvent[] = [];
    for (const rule of this.orderedRules) {
      if (rule.trigger.type !== "on_time_remaining_below") continue;
      if (remaining <= rule.trigger.seconds) {
        events.push({ type: "on_time_remaining_below", seconds: rule.trigger.seconds });
      }
    }
    return events;
  }

  private runDeferred(entry: DeferredAction, result: EngineResult, emittedOut: GameEvent[]): void {
    const ctx: ActionContext = {
      now: this.now,
      playerId: entry.event.playerId ?? this.defaultPlayerId,
      ruleId: entry.ruleId,
      event: entry.event,
    };
    const draft = cloneState(this.current);
    const out: ActionOutput = { effects: [], emitted: [] };
    try {
      this.applyActions(draft, entry.actions, ctx, out, `delay:${entry.id}`);
    } catch (error) {
      result.aborted.push({
        ruleId: entry.ruleId,
        at: this.now,
        event: entry.event,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    this.current = draft;
    result.effects.push(...out.effects);
    for (const innerEvent of out.emitted) {
      emittedOut.push(innerEvent);
    }
  }
}

/** Crea el motor sobre un estado y un conjunto de reglas (specs/05). */
export function createEngine(state: GameState, rules: Rule[], options: EngineOptions = {}): Engine {
  return new RuleEngine(state, rules, options);
}
