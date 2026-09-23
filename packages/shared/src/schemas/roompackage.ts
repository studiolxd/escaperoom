import { z } from "zod";
import { LocalizedTextSchema } from "./common";
import { PuzzleDefinitionSchema } from "./puzzle";
import { RuleConditionSchema, RuleSchema } from "./rules";
import { ItemDefSchema, MapSchema, WorldObjectSchema } from "./world";

/**
 * Valor canónico de `meta.packageFormat` (specs/08 §6). El schema solo exige
 * que el campo esté presente y no vacío (no valida el literal), pero
 * `SUPPORTED_PACKAGE_FORMATS` en `services/room-publish.ts` exige exactamente
 * este valor al publicar.
 */
export const PACKAGE_FORMAT = "roompackage/v1" as const;

/** Dificultad declarada de la sala (specs/08 §2). */
export const DifficultySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const RoomPackageMetaSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  authorId: z.string(),
  version: z.string(),
  packageFormat: z.string().min(1),
  theme: z.string(),
  description: z.string(),
  languages: z.array(z.string()).min(1),
  defaultLanguage: z.string(),
  estimatedMinutes: z.number(),
  difficulty: DifficultySchema,
  players: z.object({ min: z.number().int(), max: z.number().int() }),
  assetsManifest: z.string(),
});

/** Diálogo localizado, opcionalmente condicionado — specs/08 §2.3. */
export const DialogDefSchema = z.object({
  id: z.string(),
  text: LocalizedTextSchema,
  conditions: z.array(RuleConditionSchema).optional(),
});

/** Pista escalonada con coste — specs/08 §2.3. */
export const HintDefSchema = z.object({
  id: z.string(),
  puzzleId: z.string(),
  tier: z.number().int().positive(),
  text: LocalizedTextSchema,
  cost: z.number(),
});

/**
 * Contrato declarativo completo de una sala — specs/08 §2. Es el mismo formato
 * que consumen editor, API, base de datos, MCP y runtime.
 */
export const RoomPackageSchema = z.object({
  meta: RoomPackageMetaSchema,
  map: MapSchema,
  objects: z.array(WorldObjectSchema),
  items: z.array(ItemDefSchema),
  puzzles: z.array(PuzzleDefinitionSchema),
  rules: z.array(RuleSchema),
  dialogs: z.array(DialogDefSchema),
  hints: z.array(HintDefSchema),
});

export type Difficulty = z.infer<typeof DifficultySchema>;
export type RoomPackageMeta = z.infer<typeof RoomPackageMetaSchema>;
export type DialogDef = z.infer<typeof DialogDefSchema>;
export type HintDef = z.infer<typeof HintDefSchema>;
export type RoomPackage = z.infer<typeof RoomPackageSchema>;

/** Valida y devuelve un `RoomPackage`, lanzando un `ZodError` si es inválido. */
export function parseRoomPackage(input: unknown): RoomPackage {
  return RoomPackageSchema.parse(input);
}

/** Variante segura de `parseRoomPackage` que no lanza. */
export function safeParseRoomPackage(input: unknown) {
  return RoomPackageSchema.safeParse(input);
}
