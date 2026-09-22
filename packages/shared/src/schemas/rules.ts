import { z } from "zod";
import { PositionSchema, RectSchema } from "./common";
import { PuzzleStateSchema } from "./puzzle";

/** Valores admitidos por flags libres del creador (specs/05 §1). */
export const FlagValueSchema = z.union([z.boolean(), z.number(), z.string()]);

/** Vocabulario de triggers v1 — specs/05 §3. */
export const RuleTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("on_interact"), objectId: z.string() }),
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
 * una lista anidada de acciones), de ahí el tipo explícito y `z.lazy`.
 */
export type RuleAction =
  | { type: "set_object_state"; objectId: string; state: string }
  | { type: "unlock_door"; objectId: string }
  | { type: "grant_item"; itemId: string; to: string }
  | { type: "consume_item"; itemId: string }
  | { type: "show_dialog"; dialogId: string }
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

export const RuleActionSchema: z.ZodType<RuleAction> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("set_object_state"), objectId: z.string(), state: z.string() }),
    z.object({ type: z.literal("unlock_door"), objectId: z.string() }),
    z.object({ type: z.literal("grant_item"), itemId: z.string(), to: z.string() }),
    z.object({ type: z.literal("consume_item"), itemId: z.string() }),
    z.object({ type: z.literal("show_dialog"), dialogId: z.string() }),
    z.object({
      type: z.literal("start_timer"),
      id: z.string(),
      durationSec: z.number().optional(),
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
      type: z.literal("delay"),
      seconds: z.number(),
      actions: z.array(RuleActionSchema),
    }),
    z.object({
      type: z.literal("end_game"),
      result: z.enum(["victory", "timeout", "abandoned"]),
    }),
  ]),
);

/** Regla declarativa SI/ENTONCES — specs/08 §4. */
export const RuleSchema = z.object({
  id: z.string(),
  priority: z.number(),
  once: z.boolean(),
  trigger: RuleTriggerSchema,
  conditions: z.array(RuleConditionSchema),
  actions: z.array(RuleActionSchema),
});

export type FlagValue = z.infer<typeof FlagValueSchema>;
export type RuleTrigger = z.infer<typeof RuleTriggerSchema>;
export type RuleCondition = z.infer<typeof RuleConditionSchema>;
export type Rule = z.infer<typeof RuleSchema>;
