import { z } from "zod";
import { GridSchema, ID_PATTERN, LocalizedTextSchema, PositionSchema } from "./common";
import { MAX_CONTENT_ARRAY_ITEMS, MAX_RLE_ENTRIES, MAX_WORLD3D_HEIGHT } from "./limits";
import { Transform3DSchema } from "./world3d";

/**
 * Capa de tilemap serializada en RLE `[cantidad, tileId, ...]` (specs/04 §1).
 * `rle` topado en `MAX_RLE_ENTRIES` (auditoría D-1): sin tope, un `content.ts`
 * `roomDocToPackage`/`decodeRle` puede acabar expandiendo un array descomunal.
 */
export const TileLayerSchema = z.object({
  name: z.string(),
  rle: z.array(z.number().int()).max(MAX_RLE_ENTRIES),
});

/** Decoración "bake-able" dentro de una `SubRoom` (specs/08 §2.1). */
export const DecorationSchema = z.object({
  sprite: z.string().regex(ID_PATTERN),
  x: z.number(),
  y: z.number(),
  /**
   * `true` si es un obstáculo sólido (columna, pila de barriles…) y debe
   * bloquear su celda como un objeto sólido (revisión en vivo: las columnas
   * decorativas, sin contraparte en `objects`, se podían atravesar porque
   * `buildCollisionGrid` nunca miraba `decorations`). Por defecto `false`
   * (dressing puramente visual: alfombras, gallardetes, antorchas de pared…).
   */
  blocks: z.boolean().optional(),
});

/** Punto de aparición: uno por jugador + observador. */
export const SpawnPointSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  /** Modo 3D (specs/27 §3): altura y giro del punto de aparición; ausentes = 0. */
  h: z.number().finite().min(0).max(MAX_WORLD3D_HEIGHT).optional(),
  yaw: z.number().finite().min(0).lt(360).optional(),
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
    /** Modo 3D: altura de la antorcha (ausente = 1.6). */
    h: z.number().finite().min(0).max(MAX_WORLD3D_HEIGHT).optional(),
    objectId: z.string().optional(),
  }),
  z.object({
    type: z.literal("ambient"),
    color: z.string(),
    intensity: z.number(),
  }),
]);

/**
 * Tipo especial de habitación (encargo lobby-diseño, specs/08 §2.1): `lobby`
 * es la **sala de espera** de la partida — los jugadores aparecen en ella al
 * entrar, se mueven con su avatar y se ven entre sí mientras el anfitrión
 * espera a los demás. Solo decoración: el validador rechaza pruebas,
 * puertas y objetos que den ítems en ella (`checkLobbyRoom`). Como mucho
 * una por sala; sin ninguna, el runtime genera una por defecto
 * (`withLobbyRoom`, `schemas/lobby.ts`).
 */
export const SUBROOM_KINDS = ["lobby"] as const;
export const SubRoomKindSchema = z.enum(SUBROOM_KINDS);

/** División interna del mapa (Salón, Bodega, Catacumbas…) — specs/08 §2.1. */
export const SubRoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Ausente = habitación de juego normal; `"lobby"` = sala de espera (ver `SubRoomKindSchema`). */
  kind: SubRoomKindSchema.optional(),
  grid: GridSchema,
  layers: z.array(TileLayerSchema).max(MAX_CONTENT_ARRAY_ITEMS),
  decorations: z.array(DecorationSchema).max(MAX_CONTENT_ARRAY_ITEMS),
  spawnPoints: z.array(SpawnPointSchema).max(MAX_CONTENT_ARRAY_ITEMS),
  lighting: z.array(LightConfigSchema).max(MAX_CONTENT_ARRAY_ITEMS),
});

export const MapSchema = z.object({
  // `""` es el sentinel de "sin pack elegido todavía" (un draft recién creado
  // por `writeRoomMeta`, antes de `setTileset`): solo se exige el patrón
  // cuando SÍ hay un valor. `publish()`/el validador exigen uno real por
  // separado (el pack resuelve el manifiesto de assets, D-13).
  tileset: z.union([z.literal(""), z.string().regex(ID_PATTERN)]),
  rooms: z.array(SubRoomSchema).max(MAX_CONTENT_ARRAY_ITEMS),
});

/**
 * Estado visual de un `WorldObject`. Los estados son strings libres definidos
 * por el creador; se admite tanto el sprite suelto como un objeto con sprite y
 * animación de transición opcional (specs/04 §3.1).
 */
export const SpriteStateSchema = z.union([
  z.string().regex(ID_PATTERN),
  z.object({
    sprite: z.string().regex(ID_PATTERN).optional(),
    animation: z.string().optional(),
  }),
]);

/** Interactuable del escenario — specs/08 §2 / specs/04 §3.1. */
export const WorldObjectSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  type: z.string(),
  position: PositionSchema,
  sprite: z.string().regex(ID_PATTERN),
  states: z.record(z.string(), SpriteStateSchema),
  initialState: z.string(),
  /**
   * Nombre visible del objeto (auditoría F-27): si el creador no lo declara,
   * el runtime lo deriva del diálogo de inspección asociado y, en su defecto,
   * usa un genérico traducido — nunca el `id` técnico.
   */
  name: LocalizedTextSchema.optional(),
  inventory: z.array(z.string()).max(MAX_CONTENT_ARRAY_ITEMS).optional(),
  lockedBy: z.string().optional(),
  interactable: z.boolean(),
  distribution: z.enum(["first_click", "all_players", "assigned"]).optional(),
  hidingSpot: z.object({ contains: z.string() }).optional(),
  leadsTo: z.string().optional(),
  /**
   * Huella de varias celdas (specs/26 §2, specs/04 §3.1): celdas **adicionales**
   * (además de `position`, el ancla) que ocupa el objeto — p. ej. una mesa
   * 1×3 declara las otras dos celdas de su fila. Colisionan todas; el
   * depth-sort sigue usando solo la celda del ancla.
   */
  footprint: z.array(PositionSchema).max(8).optional(),
  /**
   * `true` si este objeto es "algo que se recoge del suelo" (revisión en
   * vivo, p. ej. el yesquero o la antorcha apagada del armario): su menú
   * contextual ofrece solo Recoger + Cancelar, no Inspeccionar/Usar objeto.
   * Igual que el `pickupObjectId` de un `hidden_key`, pero para objetos que
   * NO nacen de un escondite — los revela una regla normal (`set_object_state`
   * a un estado "visible"), y su propia regla de `on_interact` es la que
   * entrega el ítem al inspeccionarlo (recogerlo).
   */
  pickupOnly: z.boolean().optional(),
  /** Modo 3D (specs/27 §3): colocación libre; obligatorio en salas 3D, prohibido en 2D. */
  transform: Transform3DSchema.optional(),
});

/** Catálogo de objetos del inventario — specs/08 §2.4. */
export const ItemDefSchema = z.object({
  id: z.string(),
  name: LocalizedTextSchema,
  icon: z.string().regex(ID_PATTERN),
  /**
   * Texto que lleva el objeto (revisión en vivo: el pergamino de la Bodega),
   * consultable en cualquier momento seleccionándolo en el inventario —
   * aparte del diálogo que ya lo muestra la primera vez que se recoge. Sin
   * él, el panel de inventario no muestra ese bloque.
   */
  content: LocalizedTextSchema.optional(),
});

export type TileLayer = z.infer<typeof TileLayerSchema>;
export type Decoration = z.infer<typeof DecorationSchema>;
export type SpawnPoint = z.infer<typeof SpawnPointSchema>;
export type LightConfig = z.infer<typeof LightConfigSchema>;
export type SubRoom = z.infer<typeof SubRoomSchema>;
export type SubRoomKind = z.infer<typeof SubRoomKindSchema>;
export type RoomMap = z.infer<typeof MapSchema>;
export type SpriteState = z.infer<typeof SpriteStateSchema>;
export type WorldObject = z.infer<typeof WorldObjectSchema>;
export type ItemDef = z.infer<typeof ItemDefSchema>;
