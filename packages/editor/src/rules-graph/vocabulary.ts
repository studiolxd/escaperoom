import {
  PuzzleStateSchema,
  type Rule,
  type RuleAction,
  type RuleCondition,
  type RuleTrigger,
} from "@escaperoom/shared/schemas";

/**
 * Vocabulario de reglas v1 tal y como lo define el contrato (specs/05 §3,
 * `packages/shared/src/schemas/rules.ts`). El grafo NO añade tipos: estas listas
 * solo describen, para la UI, qué campos tiene cada tipo y con qué valor nace.
 */

export type TriggerType = RuleTrigger["type"];
export type ConditionType = RuleCondition["type"];
export type ActionType = RuleAction["type"];

export type { Rule, RuleAction, RuleCondition, RuleTrigger };

/** Garantiza en compilación que una lista cubre exactamente una unión de literales. */
type Exhaustive<All extends string, Listed extends readonly string[]> = [All] extends [
  Listed[number],
]
  ? Listed
  : never;

const triggerTypes = [
  "on_interact",
  "on_use_item",
  "on_enter_room",
  "on_puzzle_solved",
  "on_item_collected",
  "on_timer",
  "on_timer_end",
  "on_time_remaining_below",
  "on_all_players_in_zone",
  "on_game_start",
] as const;
export const TRIGGER_TYPES: Exhaustive<TriggerType, typeof triggerTypes> = triggerTypes;

const conditionTypes = [
  "item_in_inventory",
  "puzzle_state_is",
  "object_state_is",
  "flag_is",
  "player_count_min",
  "player_count_max",
  "time_remaining_below",
] as const;
export const CONDITION_TYPES: Exhaustive<ConditionType, typeof conditionTypes> = conditionTypes;

const actionTypes = [
  "set_object_state",
  "unlock_door",
  "grant_item",
  "consume_item",
  "show_dialog",
  "start_timer",
  "pause_timer",
  "stop_timer",
  "play_sound",
  "spawn_effect",
  "open_panel_puzzle",
  "set_flag",
  "reveal_number",
  "delay",
  "end_game",
] as const;
export const ACTION_TYPES: Exhaustive<ActionType, typeof actionTypes> = actionTypes;

/**
 * Tipos de campo editables:
 * - `string` / `number` / `int`: input de texto o numérico.
 * - `boolean`: selector sí/no (vacío = ausente si el campo es opcional).
 * - `enum`: selector con `options`.
 * - `flagValue`: `true`/`false` → boolean, numérico → number, resto → string.
 * - `json`: valor estructurado (zona como rectángulo, posición) editado como
 *   JSON; un texto que no empieza por `{` se guarda como string.
 */
export type FieldKind = "string" | "number" | "int" | "boolean" | "enum" | "flagValue" | "json";

export type FieldSpec = {
  key: string;
  kind: FieldKind;
  optional?: boolean;
  options?: readonly string[];
};

const PUZZLE_STATES = PuzzleStateSchema.options;
const END_GAME_RESULTS = ["victory", "timeout", "abandoned"] as const;

const str = (key: string): FieldSpec => ({ key, kind: "string" });

export const TRIGGER_FIELDS: Record<TriggerType, readonly FieldSpec[]> = {
  on_interact: [str("objectId")],
  on_use_item: [str("objectId"), str("itemId")],
  on_enter_room: [str("roomId")],
  on_puzzle_solved: [str("puzzleId")],
  on_item_collected: [str("itemId")],
  on_timer: [str("timerId")],
  on_timer_end: [str("timerId")],
  on_time_remaining_below: [{ key: "seconds", kind: "number" }],
  on_all_players_in_zone: [{ key: "zone", kind: "json" }],
  on_game_start: [],
};

export const CONDITION_FIELDS: Record<ConditionType, readonly FieldSpec[]> = {
  item_in_inventory: [str("itemId"), { key: "consumed", kind: "boolean", optional: true }],
  puzzle_state_is: [str("puzzleId"), { key: "state", kind: "enum", options: PUZZLE_STATES }],
  object_state_is: [str("objectId"), str("state")],
  flag_is: [str("flag"), { key: "value", kind: "flagValue" }],
  player_count_min: [{ key: "n", kind: "int" }],
  player_count_max: [{ key: "n", kind: "int" }],
  time_remaining_below: [{ key: "seconds", kind: "number" }],
};

/** `delay.actions` no es un campo: sus acciones anidadas son nodos hijos del grafo. */
export const ACTION_FIELDS: Record<ActionType, readonly FieldSpec[]> = {
  set_object_state: [str("objectId"), str("state")],
  unlock_door: [str("objectId")],
  grant_item: [str("itemId"), str("to")],
  consume_item: [str("itemId")],
  show_dialog: [str("dialogId")],
  start_timer: [str("id"), { key: "durationSec", kind: "number", optional: true }],
  pause_timer: [str("id")],
  stop_timer: [str("id")],
  play_sound: [str("soundId")],
  spawn_effect: [str("effectId"), { key: "position", kind: "json", optional: true }],
  open_panel_puzzle: [str("puzzleId")],
  set_flag: [str("flag"), { key: "value", kind: "flagValue" }],
  reveal_number: [str("objectId"), { key: "value", kind: "number" }],
  delay: [{ key: "seconds", kind: "number" }],
  end_game: [{ key: "result", kind: "enum", options: END_GAME_RESULTS }],
};

/** Valor con el que nace un campo obligatorio al crear un nodo de ese tipo. */
function defaultFieldValue(field: FieldSpec): unknown {
  switch (field.kind) {
    case "string":
    case "json":
      return field.key === "to" ? "interactor" : "";
    case "number":
      return 0;
    case "int":
      return 1;
    case "boolean":
    case "flagValue":
      return true;
    case "enum":
      return field.options?.[0] ?? "";
  }
}

function build(
  type: string,
  fields: readonly FieldSpec[],
  previous?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { type };
  for (const field of fields) {
    const kept = previous?.[field.key];
    const keepable =
      kept !== undefined &&
      (field.kind !== "enum" || (field.options ?? []).includes(kept as string));
    if (keepable) out[field.key] = kept;
    else if (!field.optional) out[field.key] = defaultFieldValue(field);
  }
  return out;
}

/**
 * Crea un trigger del tipo dado. Si se pasa `previous` (cambio de tipo de un
 * nodo existente), conserva los campos homónimos (p. ej. `objectId`).
 */
export function defaultTrigger<T extends TriggerType>(
  type: T,
  previous?: RuleTrigger,
): Extract<RuleTrigger, { type: T }> {
  return build(type, TRIGGER_FIELDS[type], previous) as Extract<RuleTrigger, { type: T }>;
}

export function defaultCondition<T extends ConditionType>(
  type: T,
  previous?: RuleCondition,
): Extract<RuleCondition, { type: T }> {
  return build(type, CONDITION_FIELDS[type], previous) as Extract<RuleCondition, { type: T }>;
}

export function defaultAction<T extends ActionType>(
  type: T,
  previous?: RuleAction,
): Extract<RuleAction, { type: T }> {
  const action = build(type, ACTION_FIELDS[type], previous);
  if (type === "delay") {
    action.actions = previous?.type === "delay" ? previous.actions : [];
  }
  return action as Extract<RuleAction, { type: T }>;
}

export function isTriggerType(value: string): value is TriggerType {
  return (TRIGGER_TYPES as readonly string[]).includes(value);
}
export function isConditionType(value: string): value is ConditionType {
  return (CONDITION_TYPES as readonly string[]).includes(value);
}
export function isActionType(value: string): value is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(value);
}
