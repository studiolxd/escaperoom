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

/** Acción del menú contextual de un objeto (specs/05 §3). */
export type RuntimeObjectAction = "inspect" | "use_item";

/**
 * `WorldObject` con el sprite del estado inicial ya resuelto.
 *
 * Además del sprite, el loader deriva la **inspección** desde las reglas
 * `on_interact` (specs/04 §4): qué diálogo mostrar y qué panel abrir. Nunca se
 * copian condiciones ni acciones crudas (podrían filtrar secretos de puzzles);
 * solo ids y un booleano de "condicionado" que el motor de reglas (1.4) usará.
 */
export interface RuntimeObject {
  id: string;
  roomId: string;
  type: string;
  position: Position;
  sprite: string;
  /**
   * Nombre visible resuelto al idioma activo (F-27): el propio del objeto o,
   * si no lo declara, el del diálogo de inspección asociado. Sin ninguno de
   * los dos, `undefined` — quien lo muestra cae a un genérico traducido,
   * nunca al `id`.
   */
  name?: string;
  /** Estados declarados, en orden de aparición (`Object.keys(states)`). */
  states: string[];
  spriteByState: Record<string, string>;
  /** Animación de transición por estado (`SpriteState.animation`) si el paquete la declara. */
  animationByState?: Record<string, string>;
  initialState: string;
  interactable: boolean;
  inventory?: string[];
  lockedBy?: string;
  leadsTo?: string;
  distribution?: "first_click" | "all_players" | "assigned";
  hidingSpot?: { contains: string };
  /** Celdas adicionales que ocupa el objeto, además de `position` (specs/26 §2). */
  footprint?: Position[];
  /** Diálogo que muestra la inspección (`on_interact` + `show_dialog`). */
  inspectDialogId?: string;
  /** Puzzle de panel que abre la inspección (`on_interact` + `open_panel_puzzle`). */
  inspectPanelPuzzleId?: string;
  /** `true` si la regla de inspección tiene condiciones (las evalúa el motor de 1.4). */
  inspectConditioned?: boolean;
  /** Imagen grande que muestra la inspección (`on_interact` + `show_image`). */
  inspectImage?: { image: string; caption?: string };
  /**
   * Acciones del menú contextual derivadas de los **triggers** de las reglas
   * (`on_interact` → `inspect`, `on_use_item` → `use_item`); sin reglas, las
   * dos. Solo tipos de trigger: nada de condiciones ni acciones.
   */
  actions?: RuntimeObjectAction[];
  /**
   * Panel de puzzle asociado al objeto: el `hidden_key` que lo usa de
   * escondite, el puzzle que lo bloquea (`lockedBy`) o el `split_clue` que lo
   * usa como mirilla (lo mismo que `RoomSession.panelForObject`).
   */
  panelPuzzleId?: string;
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
  /**
   * Geometría pública de las mecánicas de posición (el cliente de red coloca
   * al jugador sobre una placa o tras una mirilla): son posiciones del mundo,
   * no soluciones.
   */
  plates?: { objectId: string; x: number; y: number }[];
  viewpoints?: { objectId: string; x: number; y: number }[];
  /**
   * Paleta de un `split_clue` en modo `symbols`: los glifos distintos de la
   * pista **ordenados alfabéticamente** (sin posiciones ni repeticiones, así
   * que no dice qué va en cada hueco). Sin ella, cada jugador solo podría
   * teclear los glifos que ve desde su mirilla y el grupo no podría resolver.
   */
  symbols?: string[];
  /** Objeto-puente del modo solitario (cáliz, espejo), si la sala lo admite. */
  soloBridgeItemId?: string;
}

/**
 * Pista declarada **sin texto**: el texto solo llega cuando el servidor la
 * entrega (`hint_delivered`). Sirve para saber cuántos tiers hay y su coste.
 */
export interface RuntimeHint {
  puzzleId: string;
  tier: number;
  cost: number;
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
  /** Pistas sin texto, ordenadas por puzzle y tier. */
  hints?: RuntimeHint[];
}

/**
 * `RuntimeObject` sin lo que decide y entrega el SERVIDOR en partida en red
 * (auditoría D-26): ni `inventory` (qué contiene un contenedor) ni
 * `hidingSpot.contains` (qué esconde un escondite de `hidden_key`). En su
 * lugar, solo lo que la escena necesita para dibujar y ofrecer la acción —
 * `hasHidingSpot`/`inventoryCount` son **obligatorios** (a diferencia de los
 * campos que sustituyen) precisamente para que el compilador impida pasar un
 * `RuntimeObject` completo donde se espera uno público.
 */
export interface PublicRuntimeObject extends Omit<RuntimeObject, "inventory" | "hidingSpot"> {
  /** `true` si el objeto es el escondite de un `hidden_key`, sin decir qué esconde. */
  hasHidingSpot: boolean;
  /** Nº de ítems que contiene el objeto si es un contenedor, sin decir cuáles. */
  inventoryCount: number;
}

/** `RuntimeSubRoom` con sus objetos proyectados a `PublicRuntimeObject` (D-26). */
export interface PublicRuntimeSubRoom extends Omit<RuntimeSubRoom, "objects"> {
  objects: PublicRuntimeObject[];
}

/** `RuntimeModel` proyectado para la partida en red (D-26): ver `PublicRuntimeObject`. */
export interface PublicRuntimeModel
  extends Omit<RuntimeModel, "objects" | "objectsById" | "subrooms" | "subroomsById"> {
  subrooms: PublicRuntimeSubRoom[];
  subroomsById: Record<string, PublicRuntimeSubRoom>;
  objects: PublicRuntimeObject[];
  objectsById: Record<string, PublicRuntimeObject>;
}

export type {
  SubRoom,
  WorldObject,
  ItemDef,
  DialogDef,
  RoomPackage,
  PuzzleDefinition,
} from "@escaperoom/shared/schemas";
