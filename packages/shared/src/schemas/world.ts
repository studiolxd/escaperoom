import { z } from "zod";
import { GridSchema, LocalizedTextSchema, PositionSchema } from "./common";

/**
 * Capa de tilemap serializada en RLE `[cantidad, tileId, ...]` (specs/04 §1).
 */
export const TileLayerSchema = z.object({
  name: z.string(),
  rle: z.array(z.number().int()),
});

/** Decoración "bake-able" dentro de una `SubRoom` (specs/08 §2.1). */
export const DecorationSchema = z.object({
  sprite: z.string(),
  x: z.number(),
  y: z.number(),
});

/** Punto de aparición: uno por jugador + observador. */
export const SpawnPointSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
});

/**
 * Iluminación por habitación (specs/04 §3.4): antorchas ligadas a un `objectId`
 * reactivo y luz ambiental (`color`, `intensity`).
 */
export const LightConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("torch"),
    x: z.number(),
    y: z.number(),
    objectId: z.string().optional(),
  }),
  z.object({
    type: z.literal("ambient"),
    color: z.string(),
    intensity: z.number(),
  }),
]);

/** División interna del mapa (Salón, Bodega, Catacumbas…) — specs/08 §2.1. */
export const SubRoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  grid: GridSchema,
  layers: z.array(TileLayerSchema),
  decorations: z.array(DecorationSchema),
  spawnPoints: z.array(SpawnPointSchema),
  lighting: z.array(LightConfigSchema),
});

export const MapSchema = z.object({
  tileset: z.string(),
  rooms: z.array(SubRoomSchema),
});

/**
 * Estado visual de un `WorldObject`. Los estados son strings libres definidos
 * por el creador; se admite tanto el sprite suelto como un objeto con sprite y
 * animación de transición opcional (specs/04 §3.1).
 */
export const SpriteStateSchema = z.union([
  z.string(),
  z.object({
    sprite: z.string().optional(),
    animation: z.string().optional(),
  }),
]);

/** Interactuable del escenario — specs/08 §2 / specs/04 §3.1. */
export const WorldObjectSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  type: z.string(),
  position: PositionSchema,
  sprite: z.string(),
  states: z.record(z.string(), SpriteStateSchema),
  initialState: z.string(),
  inventory: z.array(z.string()).optional(),
  lockedBy: z.string().optional(),
  interactable: z.boolean(),
  distribution: z.enum(["first_click", "all_players", "assigned"]).optional(),
  hidingSpot: z.object({ contains: z.string() }).optional(),
  leadsTo: z.string().optional(),
});

/** Catálogo de objetos del inventario — specs/08 §2.4. */
export const ItemDefSchema = z.object({
  id: z.string(),
  name: LocalizedTextSchema,
  icon: z.string(),
});

export type TileLayer = z.infer<typeof TileLayerSchema>;
export type Decoration = z.infer<typeof DecorationSchema>;
export type SpawnPoint = z.infer<typeof SpawnPointSchema>;
export type LightConfig = z.infer<typeof LightConfigSchema>;
export type SubRoom = z.infer<typeof SubRoomSchema>;
export type RoomMap = z.infer<typeof MapSchema>;
export type SpriteState = z.infer<typeof SpriteStateSchema>;
export type WorldObject = z.infer<typeof WorldObjectSchema>;
export type ItemDef = z.infer<typeof ItemDefSchema>;
