import * as Y from "yjs";
import {
  PACKAGE_FORMAT,
  type DialogDef,
  type Difficulty,
  type HintDef,
  type ItemDef,
  type LocalizedText,
  type PuzzleDefinition,
  type RoomPackage,
  type RoomPackageMeta,
  type SubRoom,
  type WorldObject,
} from "@escaperoom/shared/schemas";
import {
  createYLocalizedText,
  yLocalizedTextToJSON,
  type YLocalizedText,
} from "../i18n-fields/localized-text";
import { getRoomLanguages, initRoomLanguages } from "../i18n-fields/room-languages";
import { readRules, writeRules } from "../rules-graph/yjs-rules";
import {
  ORDER_KEY,
  ROOM_DOC_KEYS,
  buildFlatRecord,
  collection,
  orderedIds,
  plain,
  readFlatRecord,
  readPlain,
  type RecordCollection,
  type RecordMap,
} from "./doc-model";
import { decodeRle, encodeRowRle, parseTileKey, tileKey } from "./tiles";

/**
 * Serialización pura doc Yjs ⇄ RoomPackage (specs/08, specs/09 §2). Es la
 * frontera entre el editor y todo lo demás: el runtime en modo edición se
 * re-renderiza desde `roomDocToPackage`, y un paquete (fixture, versión
 * publicada, salida del MCP) se abre en el editor con `roomPackageToDoc`.
 */

const META_SCALARS = [
  "id",
  "title",
  "authorId",
  "version",
  "packageFormat",
  "theme",
  "description",
  "estimatedMinutes",
  "difficulty",
  "assetsManifest",
] as const;

const ROOT_COLLECTIONS: RecordCollection[] = [
  "subrooms",
  "objects",
  "items",
  "puzzles",
  "dialogs",
  "hints",
];

// ---------------------------------------------------------------------------
// RoomPackage → doc
// ---------------------------------------------------------------------------

/** Tipo Yjs de una subroom (aún sin integrar en el doc). */
export function buildSubRoomRecord(room: SubRoom, order: number): RecordMap {
  const record = new Y.Map<unknown>();
  record.set("id", room.id);
  record.set("name", room.name);
  record.set(ORDER_KEY, order);
  record.set("cols", room.grid.cols);
  record.set("rows", room.grid.rows);

  const layerNames = new Y.Array<string>();
  layerNames.push(room.layers.map((layer) => layer.name));
  record.set("layerNames", layerNames);

  const tiles = new Y.Map<number>();
  const size = room.grid.cols * room.grid.rows;
  for (const layer of room.layers) {
    decodeRle(layer.rle, size).forEach((tileId, index) => {
      if (tileId === 0) return;
      const x = index % room.grid.cols;
      const y = Math.floor(index / room.grid.cols);
      tiles.set(tileKey(layer.name, x, y), tileId);
    });
  }
  record.set("tiles", tiles);

  for (const key of ["decorations", "spawnPoints", "lighting"] as const) {
    const list = new Y.Array<unknown>();
    list.push(plain(room[key]) as unknown[]);
    record.set(key, list);
  }
  return record;
}

function localizedRecord(
  props: Record<string, unknown>,
  field: string,
  text: LocalizedText,
  order: number,
): RecordMap {
  const record = buildFlatRecord(props, order);
  record.set(field, createYLocalizedText(text));
  return record;
}

/**
 * Sustituye el contenido del doc por el RoomPackage en una sola transacción
 * (abrir un paquete en el editor). No valida el paquete: se espera uno ya
 * validado (`parseRoomPackage`/`loadRoomPackage`).
 */
export function roomPackageToDoc(pkg: RoomPackage, doc: Y.Doc = new Y.Doc()): Y.Doc {
  doc.transact(() => {
    const meta = doc.getMap<unknown>(ROOM_DOC_KEYS.meta);
    meta.clear();
    for (const key of META_SCALARS) meta.set(key, pkg.meta[key]);
    meta.set("players", plain(pkg.meta.players));
    initRoomLanguages(doc, pkg.meta.languages, pkg.meta.defaultLanguage);

    const map = doc.getMap<unknown>(ROOM_DOC_KEYS.map);
    map.clear();
    map.set("tileset", pkg.map.tileset);

    for (const name of ROOT_COLLECTIONS) collection(doc, name).clear();

    const subrooms = collection(doc, "subrooms");
    pkg.map.rooms.forEach((room, i) => subrooms.set(room.id, buildSubRoomRecord(room, i)));

    const objects = collection(doc, "objects");
    pkg.objects.forEach((object, i) => objects.set(object.id, buildFlatRecord(object, i)));

    const items = collection(doc, "items");
    pkg.items.forEach(({ name, ...rest }, i) =>
      items.set(rest.id, localizedRecord(rest, "name", name, i)),
    );

    const puzzles = collection(doc, "puzzles");
    pkg.puzzles.forEach((puzzle, i) => puzzles.set(puzzle.id, buildFlatRecord(puzzle, i)));

    writeRules(doc, pkg.rules);

    const dialogs = collection(doc, "dialogs");
    pkg.dialogs.forEach(({ text, ...rest }, i) =>
      dialogs.set(rest.id, localizedRecord(rest, "text", text, i)),
    );

    const hints = collection(doc, "hints");
    pkg.hints.forEach(({ text, ...rest }, i) =>
      hints.set(rest.id, localizedRecord(rest, "text", text, i)),
    );
  });
  return doc;
}

// ---------------------------------------------------------------------------
// doc → RoomPackage
// ---------------------------------------------------------------------------

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readMeta(doc: Y.Doc): RoomPackageMeta {
  const meta = doc.getMap<unknown>(ROOM_DOC_KEYS.meta);
  const { languages, defaultLanguage } = getRoomLanguages(doc);
  const players = meta.get("players") as { min?: unknown; max?: unknown } | undefined;
  const difficulty = meta.get("difficulty");
  return {
    id: str(meta.get("id")),
    title: str(meta.get("title")),
    authorId: str(meta.get("authorId")),
    version: str(meta.get("version"), "0.0.0"),
    packageFormat: str(meta.get("packageFormat"), PACKAGE_FORMAT),
    theme: str(meta.get("theme")),
    description: str(meta.get("description")),
    languages,
    defaultLanguage: defaultLanguage ?? languages[0] ?? "",
    estimatedMinutes: num(meta.get("estimatedMinutes")),
    difficulty: (difficulty === 1 || difficulty === 3 ? difficulty : 2) as Difficulty,
    players: { min: num(players?.min, 1), max: num(players?.max, 1) },
    assetsManifest: str(meta.get("assetsManifest")),
  };
}

function yArrayJSON<T>(record: RecordMap, key: string): T[] {
  const value = record.get(key);
  return value instanceof Y.Array ? (value.toJSON() as T[]) : [];
}

/** Nombres de capa sin duplicados (dos creadores pueden crear la misma capa a la vez). */
export function subRoomLayerNames(record: RecordMap): string[] {
  return [...new Set(yArrayJSON<string>(record, "layerNames"))];
}

/** Rejilla fila-major de una capa de la subroom (celdas fuera de rejilla se ignoran). */
export function readLayerTiles(record: RecordMap, layer: string): number[] {
  const cols = num(record.get("cols"), 1);
  const rows = num(record.get("rows"), 1);
  const grid = new Array<number>(cols * rows).fill(0);
  const tiles = record.get("tiles");
  if (!(tiles instanceof Y.Map)) return grid;
  for (const [key, tileId] of (tiles as Y.Map<number>).entries()) {
    const cell = parseTileKey(key);
    if (!cell || cell.layer !== layer) continue;
    if (cell.x < 0 || cell.y < 0 || cell.x >= cols || cell.y >= rows) continue;
    grid[cell.y * cols + cell.x] = tileId;
  }
  return grid;
}

function readSubRoom(record: RecordMap): SubRoom {
  const cols = num(record.get("cols"), 1);
  const rows = num(record.get("rows"), 1);
  return {
    id: str(record.get("id")),
    name: str(record.get("name")),
    grid: { cols, rows },
    layers: subRoomLayerNames(record).map((name) => ({
      name,
      rle: encodeRowRle(readLayerTiles(record, name), cols),
    })),
    decorations: yArrayJSON(record, "decorations"),
    spawnPoints: yArrayJSON(record, "spawnPoints"),
    lighting: yArrayJSON(record, "lighting"),
  };
}

function readLocalized(record: RecordMap, field: string, languages: string[]): LocalizedText {
  const text = record.get(field);
  return text instanceof Y.Map ? yLocalizedTextToJSON(text as YLocalizedText, languages) : {};
}

function readCollection<T>(
  doc: Y.Doc,
  name: RecordCollection,
  read: (record: RecordMap, id: string) => T,
): T[] {
  const map = collection(doc, name);
  return orderedIds(map).map((id) => read(map.get(id) as RecordMap, id));
}

/**
 * Proyecta el doc a un RoomPackage (función pura: no muta el doc). Los textos
 * se limitan a los idiomas declarados (las traducciones retiradas se quedan en
 * el borrador, 3.10) y las capas se codifican en RLE por filas.
 */
export function roomDocToPackage(doc: Y.Doc): RoomPackage {
  const meta = readMeta(doc);
  const languages = meta.languages;
  const withoutLocalized = (record: RecordMap, field: string) => {
    const flat = readFlatRecord(record);
    delete flat[field];
    return flat;
  };

  return {
    meta,
    map: {
      tileset: str(doc.getMap<unknown>(ROOM_DOC_KEYS.map).get("tileset")),
      rooms: readCollection(doc, "subrooms", readSubRoom),
    },
    objects: readCollection(
      doc,
      "objects",
      (r, id) => ({ ...readFlatRecord(r), id }) as WorldObject,
    ),
    items: readCollection(
      doc,
      "items",
      (r, id) =>
        ({
          ...withoutLocalized(r, "name"),
          id,
          icon: str(readPlain(r, "icon")),
          name: readLocalized(r, "name", languages),
        }) as ItemDef,
    ),
    puzzles: readCollection(
      doc,
      "puzzles",
      (r, id) => ({ ...readFlatRecord(r), id }) as PuzzleDefinition,
    ),
    rules: readRules(doc),
    dialogs: readCollection(
      doc,
      "dialogs",
      (r, id) =>
        ({
          ...withoutLocalized(r, "text"),
          id,
          text: readLocalized(r, "text", languages),
        }) as DialogDef,
    ),
    hints: readCollection(
      doc,
      "hints",
      (r, id) =>
        ({
          ...withoutLocalized(r, "text"),
          id,
          puzzleId: str(readPlain(r, "puzzleId")),
          tier: num(readPlain(r, "tier"), 1),
          cost: num(readPlain(r, "cost")),
          text: readLocalized(r, "text", languages),
        }) as HintDef,
    ),
  };
}

/** Raíces del doc que forman el RoomPackage (para observar cambios). */
const OBSERVED_ROOTS = Object.values(ROOM_DOC_KEYS);

/**
 * Suscripción a cualquier cambio (propio o remoto) de la sala. Se agrupa por
 * transacción: una operación que toca varias colecciones notifica una vez.
 */
export function observeRoomDoc(doc: Y.Doc, listener: () => void): () => void {
  let dirty = false;
  const markDirty = () => {
    dirty = true;
  };
  const roots = OBSERVED_ROOTS.map((name) => doc.getMap<unknown>(name));
  for (const root of roots) root.observeDeep(markDirty);
  const onAfterTransaction = () => {
    if (!dirty) return;
    dirty = false;
    listener();
  };
  doc.on("afterTransaction", onAfterTransaction);
  return () => {
    for (const root of roots) root.unobserveDeep(markDirty);
    doc.off("afterTransaction", onAfterTransaction);
  };
}
