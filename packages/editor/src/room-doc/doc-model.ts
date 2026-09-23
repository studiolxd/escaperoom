import * as Y from "yjs";

/**
 * Forma del doc Yjs de la sala (specs/09 §2). Cada colección del RoomPackage es
 * un `Y.Map` raíz **indexado por id** (como `dialogs`/`hints`/`items` de 3.10 y
 * `rules` de 3.6), de modo que dos creadores que tocan entradas distintas nunca
 * chocan por índices:
 *
 *   meta: Y.Map
 *     id, title, authorId, version, packageFormat, theme, description,
 *     estimatedMinutes, difficulty, players (JSON), assetsManifest
 *     languages: Y.Array<string>, defaultLanguage   (3.10, `room-languages.ts`)
 *   map: Y.Map
 *     tileset: string
 *   subrooms: Y.Map<roomId, Y.Map>
 *     id, name, order, cols, rows
 *     layerNames: Y.Array<string>        orden de capas (ground, walls, decor…)
 *     tiles: Y.Map<"capa|x,y", tileId>   disperso: una celda vacía no tiene clave
 *     decorations / spawnPoints / lighting: Y.Array<JSON>
 *   objects: Y.Map<objectId, Y.Map>      una propiedad del WorldObject por clave + order
 *   items:   Y.Map<itemId, Y.Map>        id, name (YLocalizedText), icon, order
 *   puzzles: Y.Map<puzzleId, Y.Map>      una propiedad de la definición por clave + order
 *   rules:   (3.6, `rules-graph/yjs-rules.ts`)
 *   dialogs: Y.Map<dialogId, Y.Map>      id, text (YLocalizedText), conditions?, order
 *   hints:   Y.Map<hintId, Y.Map>        id, puzzleId, tier, cost, text (YLocalizedText), order
 *
 * `order` es el orden de alta (conserva el orden de los arrays del RoomPackage
 * al exportar) y no se exporta. Las celdas de tiles van en un mapa disperso por
 * clave y no en un `Y.Array` denso: pintar la misma celda a la vez desde dos
 * pestañas converge a un único valor en vez de desplazar el resto de la fila.
 */
export const ROOM_DOC_KEYS = {
  meta: "meta",
  map: "map",
  subrooms: "subrooms",
  objects: "objects",
  items: "items",
  puzzles: "puzzles",
  rules: "rules",
  dialogs: "dialogs",
  hints: "hints",
} as const;

/** Colecciones cuyas entradas son un `Y.Map` por id. */
export type RecordCollection = "subrooms" | "objects" | "items" | "puzzles" | "dialogs" | "hints";

export type RecordMap = Y.Map<unknown>;

/** Capas de tiles que ofrece el editor (specs/09 §3, paso 1): suelo, muro y decoración. */
export const EDITOR_TILE_LAYERS = ["ground", "walls", "decor"] as const;
export type EditorTileLayer = (typeof EDITOR_TILE_LAYERS)[number];

export const ORDER_KEY = "order";

export function collection(doc: Y.Doc, name: RecordCollection): Y.Map<RecordMap> {
  return doc.getMap<RecordMap>(name);
}

/** Copia JSON profunda: Yjs no admite `undefined` y no debe compartir referencias. */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Valor de una clave como JSON plano (convierte tipos Yjs anidados). */
export function readPlain(record: Y.Map<unknown>, key: string): unknown {
  const value = record.get(key);
  return value instanceof Y.AbstractType ? (value.toJSON() as unknown) : value;
}

/** Ids de una colección en orden de alta (`order`), con desempate por id. */
export function orderedIds(map: Y.Map<RecordMap>): string[] {
  const rank = (id: string) => {
    const order = map.get(id)?.get(ORDER_KEY);
    return typeof order === "number" ? order : Number.POSITIVE_INFINITY;
  };
  return [...map.keys()].sort((a, b) => {
    const diff = rank(a) - rank(b);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** Siguiente `order` libre de una colección. */
export function nextOrder(map: Y.Map<RecordMap>): number {
  let max = -1;
  for (const record of map.values()) {
    const order = record.get(ORDER_KEY);
    if (typeof order === "number") max = Math.max(max, order);
  }
  return max + 1;
}

/**
 * Entrada con una propiedad plana por clave (objetos y puzzles). Las
 * propiedades `undefined` no se escriben: el RoomPackage las trata como ausentes.
 */
export function buildFlatRecord(value: Record<string, unknown>, order: number): RecordMap {
  const record = new Y.Map<unknown>();
  for (const [key, prop] of Object.entries(value)) {
    if (prop !== undefined) record.set(key, plain(prop));
  }
  record.set(ORDER_KEY, order);
  return record;
}

/** Inversa de `buildFlatRecord` (sin `order`). */
export function readFlatRecord(record: RecordMap): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of record.keys()) {
    if (key === ORDER_KEY) continue;
    out[key] = readPlain(record, key);
  }
  return out;
}
