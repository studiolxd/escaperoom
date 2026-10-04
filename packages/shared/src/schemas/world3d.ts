import { z } from "zod";
import { ID_PATTERN, type Position } from "./common";
import {
  MAX_GRID_DIMENSION,
  MAX_INTRO_MEDIA_REF_LENGTH,
  MAX_MODEL3D_CLIPS,
  MAX_MODEL3D_COLLIDERS,
  MAX_SCALE_3D,
  MAX_WORLD3D_HEIGHT,
  MAX_WORLD3D_PIECES_PER_ROOM,
  MIN_SCALE_3D,
} from "./limits";

/**
 * Formato del mundo 3D (specs/27 §2-§3). El plano lógico `(x, y)` es el mismo
 * que en 2D (1 = 1 m); `h` es la altura y `yaw` el giro en grados `[0, 360)`.
 */

export const ROOM_DIMENSIONS = ["2d", "3d"] as const;
export const RoomDimensionSchema = z.enum(ROOM_DIMENSIONS);
export type RoomDimension = z.infer<typeof RoomDimensionSchema>;

/** Dimensión efectiva de una sala: `meta.dimension` ausente = `"2d"`. */
export function dimensionOf(meta: { dimension?: RoomDimension }): RoomDimension {
  return meta.dimension ?? "2d";
}

/** Dimensión de una fila de `room` (la columna es `TEXT` con CHECK): `"3d"` o, si no, `"2d"`. */
export function toRoomDimension(value: string): RoomDimension {
  return value === "3d" ? "3d" : "2d";
}

const coord = z.number().finite().min(0).max(MAX_GRID_DIMENSION);
const height = z.number().finite().min(0).max(MAX_WORLD3D_HEIGHT);
const yaw = z.number().finite().min(0).lt(360);
const scale = z.number().finite().min(MIN_SCALE_3D).max(MAX_SCALE_3D);

/** Colocación libre de un objeto del mundo (specs/27 §3). */
export const Transform3DSchema = z.object({
  x: coord,
  y: coord,
  h: height,
  yaw,
  scale: scale.optional(),
});

/** Id de una pieza: `p-` + 8 caracteres `[a-z0-9]`. */
export const PIECE_ID_PATTERN = /^p-[a-z0-9]{8}$/;

/** Pieza de arquitectura o decoración sin lógica (suelo, muro, columna, alfombra…). */
export const Piece3DSchema = z.object({
  id: z.string().regex(PIECE_ID_PATTERN),
  model: z.string().regex(ID_PATTERN),
  x: coord,
  y: coord,
  h: height,
  yaw,
  scale: scale.optional(),
});

export const Collider3DSchema = z.discriminatedUnion("type", [
  // Caja alineada con los ejes del modelo. c = centro, s = tamaño completo.
  z.object({
    type: z.literal("box"),
    cx: z.number().finite(),
    cy: z.number().finite(),
    ch: z.number().finite(),
    sx: z.number().positive(),
    sy: z.number().positive(),
    sh: z.number().positive(),
  }),
  // Cuña transitable: la cara superior sube de h0 a h1 avanzando en `dir`.
  z.object({
    type: z.literal("ramp"),
    cx: z.number().finite(),
    cy: z.number().finite(),
    sx: z.number().positive(),
    sy: z.number().positive(),
    h0: z.number().finite().min(0),
    h1: z.number().finite().min(0),
    dir: z.enum(["x+", "x-", "y+", "y-"]),
  }),
]);

/** Caja envolvente de un modelo (x, y, h), origen en el centro de la base. */
export const Model3DSizeSchema = z.object({
  w: z.number().positive(),
  d: z.number().positive(),
  hgt: z.number().positive(),
});

/** Modelo subido por el creador (specs/27 §9). */
export const CustomModel3DSchema = z.object({
  ref: z.string().min(1).max(MAX_INTRO_MEDIA_REF_LENGTH),
  label: z.string().max(200),
  size: Model3DSizeSchema,
  colliders: z.array(Collider3DSchema).max(MAX_MODEL3D_COLLIDERS),
  clips: z.array(z.string().max(64)).max(MAX_MODEL3D_CLIPS),
});

export const Room3DSchema = z.object({
  pieces: z.array(Piece3DSchema).max(MAX_WORLD3D_PIECES_PER_ROOM),
});

/**
 * Raíz `world3d` del paquete. El tope de modelos propios
 * (`MAX_WORLD3D_CUSTOM_MODELS`) lo comprueba el validador, no el esquema.
 */
export const World3DSchema = z.object({
  rooms: z.record(z.string(), Room3DSchema),
  models: z.record(z.string().regex(ID_PATTERN), CustomModel3DSchema),
});

/**
 * Sprite del estado «no visible» de un objeto (p. ej. la llave que aún no ha aparecido): no es un
 * modelo, el runtime no pinta nada. El validador no lo avisa como `unknown_model`.
 */
export const HIDDEN_STATE_SPRITE = "oculto";

/** `position` derivada de un `transform` (specs/27 §3.1). */
export function positionFromTransform(t: { x: number; y: number }): Position {
  return { x: Math.round(t.x), y: Math.round(t.y) };
}

export type Transform3D = z.infer<typeof Transform3DSchema>;
export type Piece3D = z.infer<typeof Piece3DSchema>;
export type Collider3D = z.infer<typeof Collider3DSchema>;
export type Model3DSize = z.infer<typeof Model3DSizeSchema>;
export type CustomModel3D = z.infer<typeof CustomModel3DSchema>;
export type Room3D = z.infer<typeof Room3DSchema>;
export type World3D = z.infer<typeof World3DSchema>;
