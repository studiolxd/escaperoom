import { z } from "zod";
import { GridSchema, PositionSchema, RectSchema } from "./common";

/**
 * Plantillas del MVP (specs/06). Las plantillas v2 (specs/07) quedan fuera de
 * este contrato por decisión del ticket 0.6.
 */
export const PUZZLE_TYPES_MVP = [
  "hidden_key",
  "code_lock",
  "simultaneous_plates",
  "combine_items",
  "sliding_puzzle",
  "memory",
  "split_clue",
  "pipes",
] as const;

export const PuzzleTypeSchema = z.enum(PUZZLE_TYPES_MVP);

/** Capa donde vive el puzzle: Phaser (`world`) o React (`panel`). */
export const PuzzleLayerSchema = z.enum(["world", "panel"]);

/** Estado sincronizado de un puzzle (specs/06 §1). */
export const PuzzleStateSchema = z.enum(["locked", "available", "in_progress", "solved", "failed"]);

/** Campos comunes a toda plantilla — specs/06 §1. */
const puzzleBase = {
  id: z.string(),
  layer: PuzzleLayerSchema,
  roomId: z.string(),
  position: PositionSchema.optional(),
  requiresSolved: z.array(z.string()),
  grantsItems: z.array(z.string()),
  unlocks: z.array(z.string()),
  timeLimitSec: z.number().optional(),
};

export const RecipeSchema = z.object({
  inputs: z.array(z.string()),
  output: z.string(),
  consumeInputs: z.boolean(),
  description: z.string().optional(),
});

export const HiddenKeyDefinitionSchema = z.object({
  ...puzzleBase,
  type: z.literal("hidden_key"),
  hidingSpot: z.object({
    objectId: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    sprite: z.string().optional(),
  }),
  revealAnimation: z.enum(["slide", "fade", "shake"]),
  keyItemId: z.string().optional(),
});

export const CodeLockDefinitionSchema = z.object({
  ...puzzleBase,
  type: z.literal("code_lock"),
  length: z.number().int().positive(),
  code: z.string(),
  maxAttempts: z.number().int().positive().optional(),
  lockoutSec: z.number().int().nonnegative().optional(),
  hints: z.array(z.string()).optional(),
});

export const SimultaneousPlatesDefinitionSchema = z.object({
  ...puzzleBase,
  type: z.literal("simultaneous_plates"),
  plates: z.array(z.object({ objectId: z.string(), x: z.number(), y: z.number() })),
  windowMs: z.number().positive(),
  soloBridgeItemId: z.string().optional(),
  holdMode: z.enum(["press", "stand"]),
});

export const CombineItemsDefinitionSchema = z.object({
  ...puzzleBase,
  type: z.literal("combine_items"),
  recipes: z.array(RecipeSchema),
});

export const SlidingPuzzleDefinitionSchema = z.object({
  ...puzzleBase,
  type: z.literal("sliding_puzzle"),
  grid: GridSchema,
  imageAsset: z.string(),
  scramble: z.enum(["random", "fixed_seed"]),
  seed: z.number().int().optional(),
  blankPosition: z.enum(["last", "random"]),
});

export const MemoryPuzzleDefinitionSchema = z.object({
  ...puzzleBase,
  type: z.literal("memory"),
  pairs: z.array(z.object({ id: z.string(), symbol: z.string() })),
  decoys: z.number().int().nonnegative().optional(),
  maxFlipsPerTurn: z.number().int().positive().optional(),
  winCondition: z.enum(["find_all_pairs", "find_target_pairs"]),
  targetPairIds: z.array(z.string()).optional(),
  turnMode: z.enum(["shared", "per_player"]),
});

export const SplitClueDefinitionSchema = z.object({
  ...puzzleBase,
  type: z.literal("split_clue"),
  viewpoints: z.array(z.object({ objectId: z.string(), zone: RectSchema })),
  fragments: z.array(z.string()),
  visibleByViewpoint: z.record(z.string(), z.array(z.string().nullable())),
  wallOccluder: RectSchema,
  soloBridgeItemId: z.string().optional(),
  inputUI: z.enum(["symbols", "code"]),
});

export const PipesPuzzleDefinitionSchema = z.object({
  ...puzzleBase,
  type: z.literal("pipes"),
  grid: GridSchema,
  cellTypes: z.array(z.enum(["straight", "curve", "tee", "cross"])),
  startCell: PositionSchema,
  endCell: PositionSchema,
  blockedCells: z
    .array(z.object({ x: z.number(), y: z.number(), opensWithItem: z.string().optional() }))
    .optional(),
  solution: z.array(z.array(z.number())).optional(),
});

/**
 * Unión discriminada por `type` con las 8 plantillas del MVP. Cada definición
 * lleva los campos comunes de `PuzzleDefinition` (specs/06 §1).
 */
export const PuzzleDefinitionSchema = z.discriminatedUnion("type", [
  HiddenKeyDefinitionSchema,
  CodeLockDefinitionSchema,
  SimultaneousPlatesDefinitionSchema,
  CombineItemsDefinitionSchema,
  SlidingPuzzleDefinitionSchema,
  MemoryPuzzleDefinitionSchema,
  SplitClueDefinitionSchema,
  PipesPuzzleDefinitionSchema,
]);

export type PuzzleType = z.infer<typeof PuzzleTypeSchema>;
export type PuzzleLayer = z.infer<typeof PuzzleLayerSchema>;
export type PuzzleState = z.infer<typeof PuzzleStateSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
export type HiddenKeyDefinition = z.infer<typeof HiddenKeyDefinitionSchema>;
export type CodeLockDefinition = z.infer<typeof CodeLockDefinitionSchema>;
export type SimultaneousPlatesDefinition = z.infer<typeof SimultaneousPlatesDefinitionSchema>;
export type CombineItemsDefinition = z.infer<typeof CombineItemsDefinitionSchema>;
export type SlidingPuzzleDefinition = z.infer<typeof SlidingPuzzleDefinitionSchema>;
export type MemoryPuzzleDefinition = z.infer<typeof MemoryPuzzleDefinitionSchema>;
export type SplitClueDefinition = z.infer<typeof SplitClueDefinitionSchema>;
export type PipesPuzzleDefinition = z.infer<typeof PipesPuzzleDefinitionSchema>;
export type PuzzleDefinition = z.infer<typeof PuzzleDefinitionSchema>;
