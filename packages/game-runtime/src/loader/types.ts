import type {
  DialogDef,
  LocalizedText,
  Position,
  PuzzleDefinition,
  RoomPackage,
} from "@escaperoom/shared/schemas";

/**
 * Modelo que consume el runtime (Phaser). Es una proyección pura y serializable
 * del `RoomPackage` (specs/08): capas RLE ya desempaquetadas a rejilla, objetos
 * agrupados por `SubRoom`, textos resueltos al idioma activo y tablas de acceso
 * por id para puertas, inventario y diálogos.
 *
 * No incluye secretos del paquete (p. ej. `code` de los `code_lock`): el modelo
 * puede viajar al cliente sin filtrar soluciones de puzzles.
 */

/** Capa de tiles desempaquetada en fila-major (`rows * cols`); `0` = celda vacía. */
export interface RuntimeTileLayer {
  name: string;
  tiles: number[];
}

/** Decoración "bake-able" posicionada en celdas. */
export interface RuntimeDecoration {
  sprite: string;
  x: number;
  y: number;
}

/** Punto de aparición con el índice de jugador derivado de su orden (1..N). */
export interface RuntimeSpawn {
  id: string;
  x: number;
  y: number;
  playerIndex: number;
}

export interface RuntimeTorchLight {
  type: "torch";
  x: number;
  y: number;
  objectId?: string;
}

export interface RuntimeAmbientLight {
  type: "ambient";
  color: string;
  intensity: number;
}

export type RuntimeLight = RuntimeTorchLight | RuntimeAmbientLight;

/** `WorldObject` con el sprite del estado inicial ya resuelto. */
export interface RuntimeObject {
  id: string;
  roomId: string;
  type: string;
  position: Position;
  sprite: string;
  spriteByState: Record<string, string>;
  initialState: string;
  interactable: boolean;
  inventory?: string[];
  lockedBy?: string;
  leadsTo?: string;
  distribution?: "first_click" | "all_players" | "assigned";
  hidingSpot?: { contains: string };
}

export interface RuntimeItem {
  id: string;
  /** `name` resuelto al idioma activo (con fallback al primer locale disponible). */
  name: string;
  icon: string;
}

export interface RuntimeDialog {
  id: string;
  /** `text` resuelto al idioma activo. */
  text: string;
  /** Texto localizado completo, para cambiar de idioma en caliente. */
  localized: LocalizedText;
  conditions?: DialogDef["conditions"];
}

/**
 * Resumen de puzzle sin secretos (`code`, `solution`, `recipes`…). El panel de
 * puzzle del runtime resuelve sus datos sensibles contra el servidor.
 */
export interface RuntimePuzzle {
  id: string;
  type: PuzzleDefinition["type"];
  roomId: string;
  layer: PuzzleDefinition["layer"];
  requiresSolved: string[];
  unlocks: string[];
  grantsItems: string[];
}

export interface RuntimeSubRoom {
  id: string;
  name: string;
  /** `grid.cols`. */
  width: number;
  /** `grid.rows`. */
  height: number;
  layers: RuntimeTileLayer[];
  decorations: RuntimeDecoration[];
  spawns: RuntimeSpawn[];
  lighting: RuntimeLight[];
  objects: RuntimeObject[];
}

export interface RuntimeMeta {
  id: string;
  title: string;
  theme: string;
  description: string;
  defaultLanguage: string;
  languages: string[];
  estimatedMinutes: number;
  difficulty: RoomPackage["meta"]["difficulty"];
  players: { min: number; max: number };
}

export interface RuntimeModel {
  meta: RuntimeMeta;
  /** Idioma con el que se resolvieron los textos (`meta.defaultLanguage` o el pedido). */
  locale: string;
  subrooms: RuntimeSubRoom[];
  subroomsById: Record<string, RuntimeSubRoom>;
  objects: RuntimeObject[];
  objectsById: Record<string, RuntimeObject>;
  items: RuntimeItem[];
  itemsById: Record<string, RuntimeItem>;
  dialogs: RuntimeDialog[];
  dialogsById: Record<string, RuntimeDialog>;
  puzzles: RuntimePuzzle[];
  puzzlesById: Record<string, RuntimePuzzle>;
}

export type {
  SubRoom,
  WorldObject,
  ItemDef,
  DialogDef,
  RoomPackage,
  PuzzleDefinition,
} from "@escaperoom/shared/schemas";
