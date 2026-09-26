import { z } from "zod";
import { LocalizedTextSchema } from "./common";
import {
  DEFAULT_ROOM_TIME_LIMIT_MINUTES,
  MAX_CONTENT_ARRAY_ITEMS,
  MAX_CONTENT_STRING_LENGTH,
  MAX_PLAYERS_PER_ROOM_CEILING,
} from "./limits";
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

/**
 * `players.max` topado a `MAX_PLAYERS_PER_ROOM_CEILING` (auditoría D-1): sin
 * tope, el validador itera de `min` a `max` evaluando la solvabilidad para
 * cada tamaño de grupo (`resolvePlayerCounts` en `validator/validate.ts`), así
 * que un `players.max` astronómico bloquea el event loop.
 *
 * `min ≤ max` NO se exige aquí con `.refine`: `RoomPackageMetaSchema` y
 * `RoomPackageSchema` tienen que seguir siendo `z.object` lisos porque
 * `create_room` (MCP) usa `.pick`/`.shape` sobre el primero y los tests usan
 * `.shape.meta.shape.packageFormat` sobre el segundo — un `.refine`/
 * `.superRefine` los convertiría en `ZodEffects` y los rompería. La tool
 * `create_room` ya valida `min ≤ max` a mano con un mensaje legible (era el
 * único punto de entrada, D-10); el tope de `max` de aquí basta para que
 * `resolvePlayerCounts` (que ya hacía `Math.max(min, max)`) no pueda iterar
 * más allá de `MAX_PLAYERS_PER_ROOM_CEILING` aunque `min > max`.
 */
const PlayersRangeSchema = z.object({
  min: z.number().int().min(1),
  max: z.number().int().min(1).max(MAX_PLAYERS_PER_ROOM_CEILING),
});

export const RoomPackageMetaSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(MAX_CONTENT_STRING_LENGTH),
  authorId: z.string(),
  version: z.string(),
  packageFormat: z.string().min(1),
  theme: z.string().max(MAX_CONTENT_STRING_LENGTH),
  description: z.string().max(MAX_CONTENT_STRING_LENGTH),
  languages: z.array(z.string()).min(1).max(MAX_CONTENT_ARRAY_ITEMS),
  defaultLanguage: z.string(),
  estimatedMinutes: z.number(),
  /**
   * Límite de partida declarado por la sala, en minutos (ticket
   * duración-salas, specs/04 §6 y specs/08 §2). Sustituye al antiguo límite
   * fijo de 1 h (`GAME_TIME_LIMIT_SEC`) — el servidor es siempre quien lo
   * aplica, nunca el cliente. Tres estados:
   * - **ausente** (`undefined`): sala publicada antes de este campo —
   *   retrocompatible con `DEFAULT_ROOM_TIME_LIMIT_MINUTES` (60 min, el
   *   límite que ya tenían todas).
   * - **`null`**: sin duración, marcado explícitamente por el creador —
   *   partida sin límite de tiempo.
   * - **entero positivo**: el límite en minutos, sin tope máximo.
   */
  timeLimitMinutes: z.number().int().positive().nullable().optional(),
  difficulty: DifficultySchema,
  players: PlayersRangeSchema,
  assetsManifest: z.string(),
  /**
   * Introducción opcional previa a la partida (encargo lobby-c13, specs/04 §7):
   * un texto localizado que cada jugador lee (y cierra cuando quiere) tras
   * "Empezar", antes de su 3-2-1. Ausente/`undefined`: sin introducción, se
   * pasa directo al 3-2-1. La variante en vídeo queda fuera de esta primera
   * entrega (ver PR): solo texto por ahora.
   */
  intro: z
    .object({
      text: LocalizedTextSchema,
    })
    .optional(),
});

/** Diálogo localizado, opcionalmente condicionado — specs/08 §2.3. */
export const DialogDefSchema = z.object({
  id: z.string(),
  text: LocalizedTextSchema,
  conditions: z.array(RuleConditionSchema).max(MAX_CONTENT_ARRAY_ITEMS).optional(),
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
  objects: z.array(WorldObjectSchema).max(MAX_CONTENT_ARRAY_ITEMS),
  items: z.array(ItemDefSchema).max(MAX_CONTENT_ARRAY_ITEMS),
  puzzles: z.array(PuzzleDefinitionSchema).max(MAX_CONTENT_ARRAY_ITEMS),
  rules: z.array(RuleSchema).max(MAX_CONTENT_ARRAY_ITEMS),
  dialogs: z.array(DialogDefSchema).max(MAX_CONTENT_ARRAY_ITEMS),
  hints: z.array(HintDefSchema).max(MAX_CONTENT_ARRAY_ITEMS),
});

export type Difficulty = z.infer<typeof DifficultySchema>;
export type RoomPackageMeta = z.infer<typeof RoomPackageMetaSchema>;
export type RoomIntro = NonNullable<RoomPackageMeta["intro"]>;
export type DialogDef = z.infer<typeof DialogDefSchema>;
export type HintDef = z.infer<typeof HintDefSchema>;
export type RoomPackage = z.infer<typeof RoomPackageSchema>;

/**
 * Resuelve el límite de partida de una sala, en segundos: `undefined` si es
 * "sin duración" (declarado `null` o, tras un override que la quite, `null`).
 * `meta.timeLimitMinutes` ausente (sala publicada antes de este campo) cae al
 * valor por defecto retrocompatible (`DEFAULT_ROOM_TIME_LIMIT_MINUTES`).
 */
export function resolveRoomTimeLimitSec(
  meta: Pick<RoomPackageMeta, "timeLimitMinutes">,
): number | undefined {
  const minutes =
    meta.timeLimitMinutes === undefined ? DEFAULT_ROOM_TIME_LIMIT_MINUTES : meta.timeLimitMinutes;
  return minutes === null ? undefined : minutes * 60;
}

/** Valida y devuelve un `RoomPackage`, lanzando un `ZodError` si es inválido. */
export function parseRoomPackage(input: unknown): RoomPackage {
  return RoomPackageSchema.parse(input);
}

/** Variante segura de `parseRoomPackage` que no lanza. */
export function safeParseRoomPackage(input: unknown) {
  return RoomPackageSchema.safeParse(input);
}
