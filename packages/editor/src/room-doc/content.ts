import * as Y from "yjs";
import type {
  DialogDef,
  Grid,
  HintDef,
  ItemDef,
  LocalizedText,
  PuzzleDefinition,
  SpawnPoint,
  TileLayer,
} from "@escaperoom/shared/schemas";
import { getRoomLanguages } from "../i18n-fields/room-languages";
import {
  RoomDocError,
  assertFreeId,
  isValidObjectId,
  packAssetsManifest,
  subRoom,
} from "./commands";
import {
  ROOM_DOC_KEYS,
  buildFlatRecord,
  collection,
  nextOrder,
  orderedIds,
  type RecordCollection,
  type RecordMap,
} from "./doc-model";
import { buildSubRoomRecord, localizedRecord } from "./serialize";
import { decodeRle, parseTileKey, tileKey } from "./tiles";

/**
 * Comandos de estructura y contenido de la sala (ticket 4.2): el resto de
 * colecciones del RoomPackage sobre la MISMA forma del doc que 3.1. Cada
 * comando es una transacción; los que dan de alta una entrada aceptan
 * `replace` para sustituir la del mismo id conservando su orden. Los usan el
 * MCP del creador y, cuando lleguen, los paneles del editor (una sola lógica).
 */

export type AddOptions = { replace?: boolean };

/** Idiomas declarados de la sala, para comprobar los textos localizados. */
function assertDeclaredLanguages(doc: Y.Doc, text: LocalizedText, field: string): void {
  const { languages } = getRoomLanguages(doc);
  const locales = Object.keys(text);
  if (locales.length === 0) {
    throw new RoomDocError("UNKNOWN_LANGUAGE", `"${field}" no tiene ningún idioma`);
  }
  const unknown = locales.filter((locale) => !languages.includes(locale));
  if (unknown.length > 0) {
    throw new RoomDocError(
      "UNKNOWN_LANGUAGE",
      `"${field}" usa idiomas no declarados en la sala (${unknown.join(", ")}); idiomas de la sala: ${languages.join(", ") || "ninguno"}`,
    );
  }
}

/**
 * Alta (o sustitución con `replace`) de una entrada en una colección por id.
 * `sharedIds` = el id vive en el espacio compartido de objetos, puzzles,
 * items, habitaciones y reglas; diálogos y pistas tienen el suyo propio.
 */
function upsertRecord(
  doc: Y.Doc,
  name: RecordCollection,
  id: string,
  build: (order: number) => RecordMap,
  opts: AddOptions & { sharedIds: boolean },
): { replaced: boolean } {
  const map = collection(doc, name);
  const existing = map.get(id);
  if (existing && opts.replace) {
    map.set(id, build(Number(existing.get("order") ?? nextOrder(map))));
    return { replaced: true };
  }
  if (opts.sharedIds) {
    assertFreeId(doc, id);
  } else {
    if (!isValidObjectId(id)) {
      throw new RoomDocError("INVALID_ID", `"${id}" no es un id válido (a-z, 0-9 y guiones)`);
    }
    if (existing) throw new RoomDocError("DUPLICATE_ID", `Ya existe el id "${id}"`);
  }
  map.set(id, build(nextOrder(map)));
  return { replaced: false };
}

// ---------------------------------------------------------------------------
// Estructura: mapa y habitaciones
// ---------------------------------------------------------------------------

/** Tileset del mapa; el manifiesto de assets pasa a ser el de su pack. */
export function setTileset(doc: Y.Doc, tileset: string): void {
  doc.transact(() => {
    doc.getMap<unknown>(ROOM_DOC_KEYS.map).set("tileset", tileset);
    doc.getMap<unknown>(ROOM_DOC_KEYS.meta).set("assetsManifest", packAssetsManifest(tileset));
  });
}

/** Borra las celdas que quedan fuera de la rejilla (al encoger una habitación). */
function pruneTilesOutside(room: RecordMap, grid: Grid): void {
  const tiles = room.get("tiles");
  if (!(tiles instanceof Y.Map)) return;
  for (const key of [...tiles.keys()]) {
    const cell = parseTileKey(key);
    if (!cell || cell.x >= grid.cols || cell.y >= grid.rows) tiles.delete(key);
  }
}

/**
 * Redimensiona una habitación y, si se indican, sustituye sus capas de tiles
 * (RLE sobre la rejilla nueva). Sin capas conserva las celdas que caben.
 */
export function setSubRoomGrid(
  doc: Y.Doc,
  roomId: string,
  grid: Grid,
  layers?: readonly TileLayer[],
): void {
  doc.transact(() => {
    const room = subRoom(doc, roomId);
    room.set("cols", grid.cols);
    room.set("rows", grid.rows);
    if (!layers) {
      pruneTilesOutside(room, grid);
      return;
    }
    const names = new Y.Array<string>();
    names.push([...new Set(layers.map((layer) => layer.name))]);
    room.set("layerNames", names);
    const tiles = new Y.Map<number>();
    for (const layer of layers) {
      let decoded: number[];
      try {
        decoded = decodeRle(layer.rle, grid.cols * grid.rows);
      } catch (error) {
        throw new RoomDocError(
          "OUT_OF_BOUNDS",
          `La capa "${layer.name}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      decoded.forEach((tileId, index) => {
        if (tileId === 0) return;
        tiles.set(tileKey(layer.name, index % grid.cols, Math.floor(index / grid.cols)), tileId);
      });
    }
    room.set("tiles", tiles);
  });
}

export type SubRoomSpec = {
  id: string;
  name: string;
  grid: Grid;
  /** Puntos de aparición; por defecto, uno si la sala aún no tiene ninguno. */
  spawnPoints?: SpawnPoint[];
};

function hasAnySpawnPoint(doc: Y.Doc): boolean {
  for (const room of collection(doc, "subrooms").values()) {
    const spawns = room.get("spawnPoints");
    if (spawns instanceof Y.Array && spawns.length > 0) return true;
  }
  return false;
}

/**
 * Define habitaciones internas: crea las nuevas (vacías, sin capas) y
 * renombra/redimensiona las existentes. La primera habitación de la sala
 * recibe un punto de aparición por defecto, como `initRoomDoc`.
 */
export function defineSubRooms(
  doc: Y.Doc,
  specs: readonly SubRoomSpec[],
): { created: string[]; updated: string[] } {
  const created: string[] = [];
  const updated: string[] = [];
  doc.transact(() => {
    const subrooms = collection(doc, "subrooms");
    for (const spec of specs) {
      const existing = subrooms.get(spec.id);
      if (existing) {
        existing.set("name", spec.name);
        setSubRoomGrid(doc, spec.id, spec.grid);
        if (spec.spawnPoints) {
          const list = new Y.Array<unknown>();
          list.push(spec.spawnPoints.map((point) => ({ ...point })));
          existing.set("spawnPoints", list);
        }
        updated.push(spec.id);
        continue;
      }
      assertFreeId(doc, spec.id);
      const spawnPoints =
        spec.spawnPoints ??
        (hasAnySpawnPoint(doc)
          ? []
          : [
              {
                id: "spawn-1",
                x: Math.floor(spec.grid.cols / 2),
                y: Math.max(0, spec.grid.rows - 2),
              },
            ]);
      subrooms.set(
        spec.id,
        buildSubRoomRecord(
          {
            id: spec.id,
            name: spec.name,
            grid: spec.grid,
            layers: [],
            decorations: [],
            spawnPoints,
            lighting: [],
          },
          nextOrder(subrooms),
        ),
      );
      created.push(spec.id);
    }
  });
  return { created, updated };
}

/** Ids de una colección en orden de alta (para mensajes accionables). */
export function listIds(doc: Y.Doc, name: RecordCollection): string[] {
  return orderedIds(collection(doc, name));
}

// ---------------------------------------------------------------------------
// Contenido: items, puzzles, diálogos y pistas
// ---------------------------------------------------------------------------

/** Entrada del catálogo de inventario (nombre localizado + icono). */
export function defineItem(
  doc: Y.Doc,
  item: ItemDef,
  opts: AddOptions = {},
): { replaced: boolean } {
  let result = { replaced: false };
  doc.transact(() => {
    assertDeclaredLanguages(doc, item.name, `${item.id}.name`);
    const { name, ...rest } = item;
    result = upsertRecord(
      doc,
      "items",
      item.id,
      (order) => localizedRecord(rest, "name", name, order),
      { ...opts, sharedIds: true },
    );
  });
  return result;
}

/** Puzzle de una plantilla (su config ya validada con el esquema de la plantilla). */
export function addPuzzle(
  doc: Y.Doc,
  puzzle: PuzzleDefinition,
  opts: AddOptions = {},
): { replaced: boolean } {
  let result = { replaced: false };
  doc.transact(() => {
    subRoom(doc, puzzle.roomId);
    result = upsertRecord(doc, "puzzles", puzzle.id, (order) => buildFlatRecord(puzzle, order), {
      ...opts,
      sharedIds: true,
    });
  });
  return result;
}

/** Texto narrativo localizado, opcionalmente condicionado. */
export function addDialog(
  doc: Y.Doc,
  dialog: DialogDef,
  opts: AddOptions = {},
): { replaced: boolean } {
  let result = { replaced: false };
  doc.transact(() => {
    assertDeclaredLanguages(doc, dialog.text, `${dialog.id}.text`);
    const { text, ...rest } = dialog;
    result = upsertRecord(
      doc,
      "dialogs",
      dialog.id,
      (order) => localizedRecord(rest, "text", text, order),
      { ...opts, sharedIds: false },
    );
  });
  return result;
}

/** Id propuesto para una pista: `hint-<puzzle>-<tier>`, con sufijo si ya existe. */
export function proposeHintId(doc: Y.Doc, puzzleId: string, tier: number): string {
  const hints = collection(doc, "hints");
  const stem = `hint-${puzzleId.replace(/^p-/, "")}-${tier}`;
  if (!hints.has(stem)) return stem;
  let n = 2;
  while (hints.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

/** Pista escalonada de un puzzle existente. */
export function addHint(doc: Y.Doc, hint: HintDef, opts: AddOptions = {}): { replaced: boolean } {
  let result = { replaced: false };
  doc.transact(() => {
    if (!collection(doc, "puzzles").has(hint.puzzleId)) {
      throw new RoomDocError("UNKNOWN_PUZZLE", `No existe el puzzle "${hint.puzzleId}"`);
    }
    assertDeclaredLanguages(doc, hint.text, `${hint.id}.text`);
    const { text, ...rest } = hint;
    result = upsertRecord(
      doc,
      "hints",
      hint.id,
      (order) => localizedRecord(rest, "text", text, order),
      { ...opts, sharedIds: false },
    );
  });
  return result;
}
