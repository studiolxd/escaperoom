import { z } from "zod";
import { LocalizedTextSchema, PositionSchema, RectSchema } from "./common";
import { MAX_ACTIONS_PER_LIST, MAX_DELAY_DEPTH, MIN_TIMER_DURATION_SEC } from "./limits";
import { PuzzleStateSchema } from "./puzzle";
import type { LocalizedText } from "./common";

/** Valores admitidos por flags libres del creador (specs/05 §1). */
export const FlagValueSchema = z.union([z.boolean(), z.number(), z.string()]);

/** Vocabulario de triggers v1 — specs/05 §3. */
export const RuleTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("on_interact"), objectId: z.string() }),
  z.object({
    type: z.literal("on_use_item"),
    objectId: z.string(),
    itemId: z.string(),
  }),
  z.object({ type: z.literal("on_enter_room"), roomId: z.string() }),
  z.object({ type: z.literal("on_puzzle_solved"), puzzleId: z.string() }),
  z.object({ type: z.literal("on_item_collected"), itemId: z.string() }),
  z.object({ type: z.literal("on_timer"), timerId: z.string() }),
  z.object({ type: z.literal("on_timer_end"), timerId: z.string() }),
  z.object({ type: z.literal("on_time_remaining_below"), seconds: z.number() }),
  z.object({
    type: z.literal("on_all_players_in_zone"),
    zone: z.union([z.string(), RectSchema]),
  }),
  z.object({ type: z.literal("on_game_start") }),
]);

/** Vocabulario de condiciones v1 — specs/05 §3. */
export const RuleConditionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("item_in_inventory"),
    itemId: z.string(),
    consumed: z.boolean().optional(),
  }),
  z.object({ type: z.literal("puzzle_state_is"), puzzleId: z.string(), state: PuzzleStateSchema }),
  z.object({ type: z.literal("object_state_is"), objectId: z.string(), state: z.string() }),
  z.object({ type: z.literal("flag_is"), flag: z.string(), value: FlagValueSchema }),
  z.object({ type: z.literal("player_count_min"), n: z.number().int() }),
  z.object({ type: z.literal("player_count_max"), n: z.number().int() }),
  z.object({ type: z.literal("time_remaining_below"), seconds: z.number() }),
]);

/**
 * Acciones declarativas v1 — specs/05 §2.3 y §3. `delay` es recursiva (contiene
 * una lista anidada de acciones), de ahí el tipo explícito.
 */
export type RuleAction =
  | { type: "set_object_state"; objectId: string; state: string }
  | { type: "unlock_door"; objectId: string }
  | { type: "grant_item"; itemId: string; to: string }
  | { type: "consume_item"; itemId: string }
  | { type: "show_dialog"; dialogId: string }
  | { type: "show_image"; image: string; caption?: LocalizedText }
  | { type: "start_timer"; id: string; durationSec?: number }
  | { type: "pause_timer"; id: string }
  | { type: "stop_timer"; id: string }
  | { type: "play_sound"; soundId: string }
  | { type: "spawn_effect"; effectId: string; position?: { x: number; y: number } }
  | { type: "open_panel_puzzle"; puzzleId: string }
  | { type: "set_flag"; flag: string; value: boolean | number | string }
  | { type: "reveal_number"; objectId: string; value: number }
  | { type: "delay"; seconds: number; actions: RuleAction[] }
  | { type: "end_game"; result: "victory" | "timeout" | "abandoned" };

/** Variantes sin `delay`: comunes a todos los niveles de anidado. */
function leafActionVariants() {
  return [
    z.object({ type: z.literal("set_object_state"), objectId: z.string(), state: z.string() }),
    z.object({ type: z.literal("unlock_door"), objectId: z.string() }),
    z.object({ type: z.literal("grant_item"), itemId: z.string(), to: z.string() }),
    z.object({ type: z.literal("consume_item"), itemId: z.string() }),
    z.object({ type: z.literal("show_dialog"), dialogId: z.string() }),
    z.object({
      type: z.literal("show_image"),
      image: z.string().min(1),
      caption: LocalizedTextSchema.optional(),
    }),
    z.object({
      type: z.literal("start_timer"),
      id: z.string(),
      durationSec: z.number().min(MIN_TIMER_DURATION_SEC).optional(),
    }),
    z.object({ type: z.literal("pause_timer"), id: z.string() }),
    z.object({ type: z.literal("stop_timer"), id: z.string() }),
    z.object({ type: z.literal("play_sound"), soundId: z.string() }),
    z.object({
      type: z.literal("spawn_effect"),
      effectId: z.string(),
      position: PositionSchema.optional(),
    }),
    z.object({ type: z.literal("open_panel_puzzle"), puzzleId: z.string() }),
    z.object({ type: z.literal("set_flag"), flag: z.string(), value: FlagValueSchema }),
    z.object({ type: z.literal("reveal_number"), objectId: z.string(), value: z.number() }),
    z.object({
      type: z.literal("end_game"),
      result: z.enum(["victory", "timeout", "abandoned"]),
    }),
  ] as const;
}

/**
 * Construye el esquema de una acción con `delay` anidable hasta `depth` niveles
 * más (auditoría D-11): en vez de `z.lazy` (recursión sin fondo — un JSON de
 * ~1 MB con miles de `delay` anidados revienta la pila del propio parser antes
 * de que corra ningún `superRefine`), el esquema se construye una vez, finito,
 * con `depth` niveles concretos. Un `delay` más allá de `MAX_DELAY_DEPTH`
 * simplemente no matchea ningún literal de `type` en el nivel más profundo y
 * Zod lo rechaza como acción inválida, sin recursar más.
 */
function buildActionSchema(depth: number): z.ZodType<RuleAction> {
  const variants = leafActionVariants();
  if (depth <= 0) {
    return z.discriminatedUnion("type", variants) as unknown as z.ZodType<RuleAction>;
  }
  const nested = buildActionSchema(depth - 1);
  return z.discriminatedUnion("type", [
    ...variants,
    z.object({
      type: z.literal("delay"),
      seconds: z.number(),
      actions: z.array(nested).max(MAX_ACTIONS_PER_LIST),
    }),
  ]) as unknown as z.ZodType<RuleAction>;
}

export const RuleActionSchema: z.ZodType<RuleAction> = buildActionSchema(MAX_DELAY_DEPTH);

/** Regla declarativa SI/ENTONCES — specs/08 §4. */
export const RuleSchema = z.object({
  id: z.string(),
  priority: z.number(),
  once: z.boolean(),
  trigger: RuleTriggerSchema,
  conditions: z.array(RuleConditionSchema).max(MAX_ACTIONS_PER_LIST),
  actions: z.array(RuleActionSchema).max(MAX_ACTIONS_PER_LIST),
});

export type FlagValue = z.infer<typeof FlagValueSchema>;
export type RuleTrigger = z.infer<typeof RuleTriggerSchema>;
export type RuleCondition = z.infer<typeof RuleConditionSchema>;
export type Rule = z.infer<typeof RuleSchema>;
