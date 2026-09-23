import * as Y from "yjs";
import type { Position, RoomPackageMeta, WorldObject } from "@escaperoom/shared/schemas";
import { initRoomLanguages } from "../i18n-fields/room-languages";
import {
  ROOM_DOC_KEYS,
  buildFlatRecord,
  collection,
  nextOrder,
  readFlatRecord,
  type RecordMap,
} from "./doc-model";
import { DEFAULT_PACKAGE_FORMAT, buildSubRoomRecord, readLayerTiles } from "./serialize";
import { tileKey } from "./tiles";

/**
 * Capa de comandos del editor (specs/09 §3, pasos 1–2): cada herramienta del
 * modo edición (pincel, relleno, borrador, colocar, arrastrar, renombrar) es
 * una transacción Yjs sobre el doc. Nada se guarda en estado local: el runtime
 * se re-renderiza desde el doc, así que un cambio remoto (otra pestaña, el MCP)
 * y uno local siguen exactamente el mismo camino.
 */

export type RoomDocErrorCode =
  | "UNKNOWN_ROOM"
  | "UNKNOWN_OBJECT"
  | "OUT_OF_BOUNDS"
  | "DUPLICATE_ID"
  | "INVALID_ID"
  | "REFERENCED_ID"
  | "UNKNOWN_PUZZLE"
  | "UNKNOWN_ITEM"
  | "UNKNOWN_DIALOG"
  | "UNKNOWN_LANGUAGE"
  | "UNKNOWN_DECORATION"
  | "UNKNOWN_LIGHT"
  | "INVALID_VALUE";

export class RoomDocError extends Error {
  readonly code: RoomDocErrorCode;
  constructor(code: RoomDocErrorCode, message: string) {
    super(message);
    this.name = "RoomDocError";
    this.code = code;
  }
}

export type Cell = { x: number; y: number };

/** Entrada de la habitación interna, o `UNKNOWN_ROOM`. */
export function subRoom(doc: Y.Doc, roomId: string): RecordMap {
  const room = collection(doc, "subrooms").get(roomId);
  if (!room) throw new RoomDocError("UNKNOWN_ROOM", `No existe la habitación "${roomId}"`);
  return room;
}

function gridOf(room: RecordMap): { cols: number; rows: number } {
  return { cols: Number(room.get("cols") ?? 0), rows: Number(room.get("rows") ?? 0) };
}

/** ¿Está la celda dentro de la rejilla de la habitación? */
export function isCellInRoom(doc: Y.Doc, roomId: string, cell: Cell): boolean {
  const room = collection(doc, "subrooms").get(roomId);
  if (!room) return false;
  const { cols, rows } = gridOf(room);
  return (
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) &&
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.x < cols &&
    cell.y < rows
  );
}

function tilesOf(room: RecordMap): Y.Map<number> {
  const tiles = room.get("tiles");
  if (tiles instanceof Y.Map) return tiles as Y.Map<number>;
  const created = new Y.Map<number>();
  room.set("tiles", created);
  return created;
}

/** Declara la capa en la habitación si aún no existe (pintar en `decor` la crea). */
function ensureLayer(room: RecordMap, layer: string): void {
  let names = room.get("layerNames");
  if (!(names instanceof Y.Array)) {
    names = new Y.Array<string>();
    room.set("layerNames", names);
  }
  const list = names as Y.Array<string>;
  if (!list.toArray().includes(layer)) list.push([layer]);
}

function setCell(tiles: Y.Map<number>, layer: string, cell: Cell, tileId: number): boolean {
  const key = tileKey(layer, cell.x, cell.y);
  const current = tiles.get(key) ?? 0;
  if (current === tileId) return false;
  if (tileId === 0) tiles.delete(key);
  else tiles.set(key, tileId);
  return true;
}

/** Tile de una celda de una capa (`0` = vacía). */
export function getTile(doc: Y.Doc, roomId: string, layer: string, cell: Cell): number {
  const tiles = subRoom(doc, roomId).get("tiles");
  return tiles instanceof Y.Map
    ? ((tiles as Y.Map<number>).get(tileKey(layer, cell.x, cell.y)) ?? 0)
    : 0;
}

/**
 * Pincel: pinta `tileId` en las celdas dadas de una capa (las que caen fuera de
 * la rejilla se ignoran). `tileId = 0` borra. Devuelve cuántas celdas cambiaron.
 */
export function paintTiles(
  doc: Y.Doc,
  roomId: string,
  layer: string,
  cells: readonly Cell[],
  tileId: number,
): number {
  let changed = 0;
  doc.transact(() => {
    const room = subRoom(doc, roomId);
    const inside = cells.filter((cell) => isCellInRoom(doc, roomId, cell));
    if (inside.length === 0) return;
    if (tileId !== 0) ensureLayer(room, layer);
    const tiles = tilesOf(room);
    for (const cell of inside) if (setCell(tiles, layer, cell, tileId)) changed++;
  });
  return changed;
}

/** Borrador: vacía las celdas dadas de una capa. */
export function eraseTiles(
  doc: Y.Doc,
  roomId: string,
  layer: string,
  cells: readonly Cell[],
): number {
  return paintTiles(doc, roomId, layer, cells, 0);
}

/**
 * Relleno (bote de pintura): sustituye por `tileId` la región 4-conexa de la
 * capa que comparte el tile de la celda de origen. Devuelve las celdas pintadas.
 */
export function fillTiles(
  doc: Y.Doc,
  roomId: string,
  layer: string,
  origin: Cell,
  tileId: number,
): number {
  if (!isCellInRoom(doc, roomId, origin)) return 0;
  const room = subRoom(doc, roomId);
  const { cols, rows } = gridOf(room);
  const grid = readLayerTiles(room, layer);
  const target = grid[origin.y * cols + origin.x] ?? 0;
  if (target === tileId) return 0;

  const region: Cell[] = [];
  const seen = new Uint8Array(cols * rows);
  const stack: Cell[] = [origin];
  while (stack.length > 0) {
    const cell = stack.pop() as Cell;
    if (cell.x < 0 || cell.y < 0 || cell.x >= cols || cell.y >= rows) continue;
    const index = cell.y * cols + cell.x;
    if (seen[index] || grid[index] !== target) continue;
    seen[index] = 1;
    region.push(cell);
    stack.push(
      { x: cell.x + 1, y: cell.y },
      { x: cell.x - 1, y: cell.y },
      { x: cell.x, y: cell.y + 1 },
      { x: cell.x, y: cell.y - 1 },
    );
  }
  return paintTiles(doc, roomId, layer, region, tileId);
}

// ---------------------------------------------------------------------------
// Objetos
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Ids legibles: minúsculas, dígitos y guiones (`arca-trono`). */
export function isValidObjectId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/** Pasa un texto a slug de id (`"Arca cerrada"` → `"arca-cerrada"`). */
export function slugifyId(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "objeto";
}

/** Ids ya usados en cualquier colección con id (objetos, puzzles, items…). */
export function usedIds(doc: Y.Doc): Set<string> {
  const ids = new Set<string>();
  for (const name of ["objects", "puzzles", "items", "subrooms"] as const) {
    for (const id of collection(doc, name).keys()) ids.add(id);
  }
  for (const id of doc.getMap(ROOM_DOC_KEYS.rules).keys()) ids.add(id);
  return ids;
}

/**
 * Id legible propuesto al colocar un objeto (specs/09 §3): el sprite más la
 * última palabra de la habitación (`arca` en `salon-trono` → `arca-trono`), con
 * sufijo numérico si ya existe. El creador lo puede cambiar (`renameObject`).
 */
export function proposeObjectId(doc: Y.Doc, sprite: string, roomId: string): string {
  const roomSuffix = slugifyId(roomId).split("-").pop() ?? "";
  const base = slugifyId(sprite);
  const stem = roomSuffix && !base.endsWith(roomSuffix) ? `${base}-${roomSuffix}` : base;
  const used = usedIds(doc);
  if (!used.has(stem)) return stem;
  let n = 2;
  while (used.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

export type PlaceObjectInput = {
  roomId: string;
  sprite: string;
  position: Cell;
  /** Id elegido; por defecto `proposeObjectId`. */
  id?: string;
  /** Tipo libre del objeto (specs/04 §3.1); por defecto `decorativo`. */
  type?: string;
  interactable?: boolean;
};

export function assertInside(doc: Y.Doc, roomId: string, cell: Cell): void {
  if (!isCellInRoom(doc, roomId, cell)) {
    throw new RoomDocError(
      "OUT_OF_BOUNDS",
      `La celda (${cell.x}, ${cell.y}) está fuera de la habitación "${roomId}"`,
    );
  }
}

/** Id legible y libre en el espacio de ids compartido (objetos, puzzles, items, habitaciones, reglas). */
export function assertFreeId(doc: Y.Doc, id: string): void {
  if (!isValidObjectId(id)) {
    throw new RoomDocError("INVALID_ID", `"${id}" no es un id válido (a-z, 0-9 y guiones)`);
  }
  if (usedIds(doc).has(id)) throw new RoomDocError("DUPLICATE_ID", `Ya existe el id "${id}"`);
}

/**
 * Coloca un objeto de la palette en una celda. Los estados, reglas y puzzles
 * que lo usen se configuran después (inspector 3.4, plantillas 3.5).
 */
export function placeObject(doc: Y.Doc, input: PlaceObjectInput): string {
  const id = input.id ?? proposeObjectId(doc, input.sprite, input.roomId);
  doc.transact(() => {
    subRoom(doc, input.roomId);
    assertInside(doc, input.roomId, input.position);
    assertFreeId(doc, id);
    const object: WorldObject = {
      id,
      roomId: input.roomId,
      type: input.type ?? "decorativo",
      position: { x: input.position.x, y: input.position.y },
      sprite: input.sprite,
      states: {},
      initialState: "",
      interactable: input.interactable ?? true,
    };
    const objects = collection(doc, "objects");
    objects.set(id, buildFlatRecord(object, nextOrder(objects)));
  });
  return id;
}

/**
 * Alta de un objeto completo (estados, inventario, cerradura…), la variante
 * de `placeObject` para quien ya trae el `WorldObject` entero (MCP, 4.2). Con
 * `replace`, sustituye la entrada del mismo id conservando su orden.
 */
export function addObject(
  doc: Y.Doc,
  object: WorldObject,
  opts: { replace?: boolean } = {},
): { replaced: boolean } {
  let replaced = false;
  doc.transact(() => {
    subRoom(doc, object.roomId);
    assertInside(doc, object.roomId, object.position);
    const objects = collection(doc, "objects");
    const existing = objects.get(object.id);
    if (existing && opts.replace) {
      replaced = true;
      objects.set(object.id, buildFlatRecord(object, Number(existing.get("order") ?? 0)));
      return;
    }
    assertFreeId(doc, object.id);
    objects.set(object.id, buildFlatRecord(object, nextOrder(objects)));
  });
  return { replaced };
}

function objectRecord(doc: Y.Doc, id: string): RecordMap {
  const record = collection(doc, "objects").get(id);
  if (!record) throw new RoomDocError("UNKNOWN_OBJECT", `No existe el objeto "${id}"`);
  return record;
}

/** Objeto del doc como `WorldObject`, o `undefined`. */
export function readObject(doc: Y.Doc, id: string): WorldObject | undefined {
  const record = collection(doc, "objects").get(id);
  return record ? ({ ...readFlatRecord(record), id } as WorldObject) : undefined;
}

/**
 * Arrastre: mueve un objeto a otra celda (y opcionalmente a otra habitación).
 * Devuelve `false` si ya estaba ahí.
 */
export function moveObject(doc: Y.Doc, id: string, position: Cell, roomId?: string): boolean {
  let moved = false;
  doc.transact(() => {
    const record = objectRecord(doc, id);
    const targetRoom = roomId ?? String(record.get("roomId"));
    subRoom(doc, targetRoom);
    assertInside(doc, targetRoom, position);
    const current = record.get("position") as Position | undefined;
    if (
      current?.x === position.x &&
      current?.y === position.y &&
      targetRoom === record.get("roomId")
    ) {
      return;
    }
    record.set("position", { x: position.x, y: position.y });
    if (targetRoom !== record.get("roomId")) record.set("roomId", targetRoom);
    moved = true;
  });
  return moved;
}

export function removeObject(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    objectRecord(doc, id);
    collection(doc, "objects").delete(id);
  });
}

/** ¿Aparece `id` como valor de texto en algún lugar de la sala (salvo su propia entrada)? */
export function findIdReferences(doc: Y.Doc, id: string): string[] {
  const refs: string[] = [];
  const scan = (value: unknown, path: string) => {
    if (value === id) refs.push(path);
    else if (Array.isArray(value)) value.forEach((v, i) => scan(v, `${path}[${i}]`));
    else if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value)) scan(v, `${path}.${key}`);
    }
  };
  for (const root of Object.values(ROOM_DOC_KEYS)) {
    if (root === ROOM_DOC_KEYS.meta) continue;
    const map = doc.getMap<unknown>(root);
    for (const [key, value] of map.entries()) {
      if (root === ROOM_DOC_KEYS.objects && key === id) continue;
      scan(value instanceof Y.AbstractType ? value.toJSON() : value, `${root}.${key}`);
    }
  }
  return refs;
}

/**
 * Renombra un objeto (ids editables, specs/09 §3). Solo si nada lo referencia
 * todavía: reescribir referencias en reglas y puzzles es trabajo del inspector
 * (3.4); así un renombrado nunca deja una regla apuntando a un id que no existe.
 */
export function renameObject(doc: Y.Doc, id: string, newId: string): void {
  if (id === newId) return;
  doc.transact(() => {
    const record = objectRecord(doc, id);
    assertFreeId(doc, newId);
    const refs = findIdReferences(doc, id);
    if (refs.length > 0) {
      throw new RoomDocError(
        "REFERENCED_ID",
        `"${id}" se usa en ${refs.join(", ")}; cámbialo desde el inspector`,
      );
    }
    const objects = collection(doc, "objects");
    const value = readFlatRecord(record);
    const order = Number(record.get("order") ?? nextOrder(objects));
    objects.delete(id);
    objects.set(newId, buildFlatRecord({ ...value, id: newId }, order));
  });
}

// ---------------------------------------------------------------------------
// Sala nueva
// ---------------------------------------------------------------------------

/** Tileset de una sala nueva (el pack del fixture del Rey Aldric). */
export const DEFAULT_TILESET = "medieval-v1";

/** Manifiesto de assets del pack de un tileset. */
export function packAssetsManifest(tileset: string): string {
  return `r2://assets/packs/${tileset}/manifest.json`;
}

/** Metadata de una sala nueva: lo obligatorio y, para lo demás, los valores por defecto. */
export type RoomMetaInput = Pick<
  RoomPackageMeta,
  "id" | "title" | "authorId" | "theme" | "languages" | "defaultLanguage"
> &
  Partial<RoomPackageMeta>;

/**
 * Escribe la metadata completa de la sala (una transacción). Los campos que
 * no se indican toman el valor por defecto de una sala nueva.
 */
export function writeRoomMeta(doc: Y.Doc, input: RoomMetaInput): void {
  doc.transact(() => {
    const meta = doc.getMap<unknown>(ROOM_DOC_KEYS.meta);
    meta.set("id", input.id);
    meta.set("title", input.title);
    meta.set("authorId", input.authorId);
    meta.set("version", input.version ?? "0.0.0");
    meta.set("packageFormat", input.packageFormat ?? DEFAULT_PACKAGE_FORMAT);
    meta.set("theme", input.theme);
    meta.set("description", input.description ?? "");
    meta.set("estimatedMinutes", input.estimatedMinutes ?? 30);
    meta.set("difficulty", input.difficulty ?? 2);
    meta.set("players", { ...(input.players ?? { min: 1, max: 4 }) });
    meta.set("assetsManifest", input.assetsManifest ?? packAssetsManifest(DEFAULT_TILESET));
    initRoomLanguages(doc, input.languages, input.defaultLanguage);
  });
}

export type InitRoomDocInput = {
  id: string;
  title: string;
  authorId?: string;
  language: string;
  tileset?: string;
  theme?: string;
  /** Habitación inicial (por defecto `sala-1`, 12×10 con suelo `1`). */
  room?: { id: string; name: string; cols: number; rows: number; floorTileId?: number };
};

/** ¿El doc aún no tiene sala (borrador recién creado)? */
export function isRoomDocEmpty(doc: Y.Doc): boolean {
  return collection(doc, "subrooms").size === 0 && !doc.getMap(ROOM_DOC_KEYS.meta).has("id");
}

/**
 * Esqueleto de una sala nueva: meta mínima válida y una habitación con suelo.
 * No hace nada si el doc ya tiene contenido (otro colaborador lo inicializó).
 */
export function initRoomDoc(doc: Y.Doc, input: InitRoomDocInput): boolean {
  if (!isRoomDocEmpty(doc)) return false;
  const room = input.room ?? { id: "sala-1", name: input.title, cols: 12, rows: 10 };
  const floor = room.floorTileId ?? 1;
  doc.transact(() => {
    const tileset = input.tileset ?? DEFAULT_TILESET;
    writeRoomMeta(doc, {
      id: input.id,
      title: input.title,
      authorId: input.authorId ?? "",
      theme: input.theme ?? "medieval",
      languages: [input.language],
      defaultLanguage: input.language,
      assetsManifest: packAssetsManifest(tileset),
    });
    doc.getMap<unknown>(ROOM_DOC_KEYS.map).set("tileset", tileset);

    const size = room.cols * room.rows;
    const subrooms = collection(doc, "subrooms");
    subrooms.set(
      room.id,
      buildSubRoomRecord(
        {
          id: room.id,
          name: room.name,
          grid: { cols: room.cols, rows: room.rows },
          layers: [{ name: "ground", rle: [size, floor] }],
          decorations: [],
          spawnPoints: [{ id: "spawn-1", x: Math.floor(room.cols / 2), y: room.rows - 2 }],
          lighting: [],
        },
        nextOrder(subrooms),
      ),
    );
  });
  return true;
}
