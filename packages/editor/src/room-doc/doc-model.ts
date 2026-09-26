import * as Y from "yjs";

/**
 * Forma del doc Yjs de la sala (specs/09 §2). Cada colección del RoomPackage es
 * un `Y.Map` raíz **indexado por id** (como `dialogs`/`hints`/`items` de 3.10 y
 * `rules` de 3.6), de modo que dos creadores que tocan entradas distintas nunca
 * chocan por índices:
 *
 *   meta: Y.Map
 *     id, title, authorId, version, packageFormat, theme, description,
 *     estimatedMinutes, timeLimitMinutes (número | null = sin duración),
 *     difficulty, players (JSON), assetsManifest
 *     languages: Y.Array<string>, defaultLanguage   (3.10, `room-languages.ts`)
 *     intro?: Y.Map                      introducción (lobby-diseño, `lobby-intro.ts`):
 *       type "text": text (YLocalizedText) | type "video": video (ref), subtitles: Y.Map<idioma, ref>
 *   map: Y.Map
 *     tileset: string
 *   subrooms: Y.Map<roomId, Y.Map>
 *     id, name, kind? ("lobby" = sala de espera), order, cols, rows
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
  /** Versión de la FORMA del doc (auditoría D-24), no de `meta.packageFormat`. */
  docFormat: "docFormat",
} as const;

/**
 * Versión actual de la forma del doc Yjs (specs/09 §2). Hoy solo hay una: esto
 * reserva el hueco para que un cambio futuro de la forma del doc (nueva
 * colección, campo movido…) pueda distinguir un doc viejo de uno nuevo antes
 * de leerlo, igual que `meta.packageFormat` lo hace para el `RoomPackage`
 * (auditoría D-24, ADR-028). Ningún doc real ha necesitado migrar todavía.
 */
export const CURRENT_ROOM_DOC_FORMAT = 1;

/** Versión de la forma del doc; `0` si es anterior a que este campo existiera. */
export function readRoomDocFormat(doc: Y.Doc): number {
  const value = doc.getMap<unknown>(ROOM_DOC_KEYS.docFormat).get("version");
  return typeof value === "number" ? value : 0;
}

/** Sella el doc con la versión actual de su forma (salas nuevas y cargadas de un `RoomPackage`). */
export function writeRoomDocFormat(doc: Y.Doc): void {
  doc.getMap<unknown>(ROOM_DOC_KEYS.docFormat).set("version", CURRENT_ROOM_DOC_FORMAT);
}

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

/**
 * Claves que nunca se copian de un `Y.Map` a un objeto plano (auditoría D-27):
 * un `Y.Map` sincronizado puede traer cualquier clave de otro colaborador (o
 * de un update Yjs manipulado), y `out[key] = …` con `key === "__proto__"`
 * contamina el prototipo del objeto que se está construyendo.
 */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Inversa de `buildFlatRecord` (sin `order`). */
export function readFlatRecord(record: RecordMap): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of record.keys()) {
    if (key === ORDER_KEY || DANGEROUS_KEYS.has(key)) continue;
    out[key] = readPlain(record, key);
  }
  return out;
}
