import {
  RoomPackageSchema,
  formatRoomPackageError,
  toReadableIssues,
  type LocalizedText,
  type RoomPackage,
  type SpriteState,
  type SubRoom,
  type TileLayer,
  type WorldObject,
} from "@escaperoom/shared/schemas";
import { RoomPackageLoadError } from "./errors";
import type {
  RuntimeDialog,
  RuntimeItem,
  RuntimeLight,
  RuntimeModel,
  RuntimeObject,
  RuntimePuzzle,
  RuntimeSubRoom,
} from "./types";

export interface ToRuntimeModelOptions {
  /** Locale con el que resolver los `LocalizedText`; por defecto `meta.defaultLanguage`. */
  locale?: string;
}

/**
 * Carga y valida un `RoomPackage` con el schema de 0.6. Acepta un objeto ya
 * parseado o una cadena JSON. Lanza `RoomPackageLoadError` con las rutas de los
 * campos inválidos si el documento no cumple el contrato (specs/08).
 */
export function loadRoomPackage(input: unknown): RoomPackage {
  let candidate = input;

  if (typeof input === "string") {
    try {
      candidate = JSON.parse(input) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new RoomPackageLoadError(
        `RoomPackage inválido: el JSON no se puede parsear (${detail})`,
      );
    }
  }

  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new RoomPackageLoadError(
      "RoomPackage inválido: se esperaba un objeto JSON con las claves meta, map, objects, items, puzzles, rules, dialogs y hints.",
    );
  }

  const result = RoomPackageSchema.safeParse(candidate);
  if (!result.success) {
    throw new RoomPackageLoadError(
      `RoomPackage inválido:\n${formatRoomPackageError(result.error)}`,
      toReadableIssues(result.error),
    );
  }

  return result.data;
}

/** `loadRoomPackage` + `toRuntimeModel` en un solo paso (atajo del runtime). */
export function loadRuntimeModel(
  input: unknown,
  options: ToRuntimeModelOptions = {},
): RuntimeModel {
  return toRuntimeModel(loadRoomPackage(input), options);
}

/**
 * Proyecta un `RoomPackage` válido al modelo que consume el runtime: subrooms
 * con sus capas desempaquetadas (RLE normalizado a la rejilla), objetos
 * agrupados por habitación, items, diálogos y spawns. Lanza
 * `RoomPackageLoadError` si el documento es inconsistente: ids duplicados,
 * referencias a habitaciones inexistentes, posiciones fuera de la rejilla o un
 * RLE mal formado.
 */
export function toRuntimeModel(
  roomPackage: RoomPackage,
  options: ToRuntimeModelOptions = {},
): RuntimeModel {
  const { meta, map } = roomPackage;
  const locale = options.locale ?? meta.defaultLanguage;

  const subrooms: RuntimeSubRoom[] = [];
  const subroomsById: Record<string, RuntimeSubRoom> = {};

  for (const room of map.rooms) {
    if (subroomsById[room.id]) {
      throw new RoomPackageLoadError(
        `RoomPackage inválido: hay más de una habitación con el id "${room.id}". Los ids de habitación deben ser únicos.`,
      );
    }

    const runtimeRoom = toRuntimeSubRoom(room);
    subrooms.push(runtimeRoom);
    subroomsById[room.id] = runtimeRoom;
  }

  const objects: RuntimeObject[] = [];
  const objectsById: Record<string, RuntimeObject> = {};

  for (const object of roomPackage.objects) {
    const room = subroomsById[object.roomId];
    if (!room) {
      throw new RoomPackageLoadError(
        `RoomPackage inválido: el objeto "${object.id}" referencia la habitación "${object.roomId}", que no existe en map.rooms.`,
      );
    }
    assertInGrid(room, object.position.x, object.position.y, `el objeto "${object.id}"`);
    if (objectsById[object.id]) {
      throw new RoomPackageLoadError(
        `RoomPackage inválido: hay más de un objeto con el id "${object.id}". Los ids de objeto deben ser únicos.`,
      );
    }

    const runtimeObject = toRuntimeObject(object);
    objects.push(runtimeObject);
    objectsById[runtimeObject.id] = runtimeObject;
    room.objects.push(runtimeObject);
  }

  const items: RuntimeItem[] = roomPackage.items.map((item) => ({
    id: item.id,
    name: resolveLocalizedText(item.name, locale),
    icon: item.icon,
  }));

  const dialogs: RuntimeDialog[] = roomPackage.dialogs.map((dialog) => ({
    id: dialog.id,
    text: resolveLocalizedText(dialog.text, locale),
    localized: dialog.text,
    ...(dialog.conditions ? { conditions: dialog.conditions } : {}),
  }));

  const puzzles: RuntimePuzzle[] = roomPackage.puzzles.map((puzzle) => ({
    id: puzzle.id,
    type: puzzle.type,
    roomId: puzzle.roomId,
    layer: puzzle.layer,
    requiresSolved: puzzle.requiresSolved,
    unlocks: puzzle.unlocks,
    grantsItems: puzzle.grantsItems,
  }));

  return {
    meta: {
      id: meta.id,
      title: meta.title,
      theme: meta.theme,
      description: meta.description,
      defaultLanguage: meta.defaultLanguage,
      languages: meta.languages,
      estimatedMinutes: meta.estimatedMinutes,
      difficulty: meta.difficulty,
      players: meta.players,
    },
    locale,
    subrooms,
    subroomsById,
    objects,
    objectsById,
    items,
    itemsById: indexById(items),
    dialogs,
    dialogsById: indexById(dialogs),
    puzzles,
    puzzlesById: indexById(puzzles),
  };
}

/** Resuelve un `LocalizedText` al locale pedido, con fallback al primer idioma. */
export function resolveLocalizedText(text: LocalizedText, locale: string): string {
  const preferred = text[locale];
  if (preferred) {
    return preferred.text;
  }
  const first = Object.values(text)[0];
  return first?.text ?? "";
}

function toRuntimeSubRoom(room: SubRoom): RuntimeSubRoom {
  const { cols, rows } = room.grid;
  const cells = cols * rows;

  const layers = room.layers.map((layer) => ({
    name: layer.name,
    tiles: unpackRle(layer, cells, room),
  }));

  const spawns = room.spawnPoints.map((spawn, index) => {
    assertInGridById(room.id, cols, rows, spawn.x, spawn.y, `el punto de aparición "${spawn.id}"`);
    return { id: spawn.id, x: spawn.x, y: spawn.y, playerIndex: index + 1 };
  });

  return {
    id: room.id,
    name: room.name,
    width: cols,
    height: rows,
    layers,
    decorations: room.decorations.map((decoration) => ({
      sprite: decoration.sprite,
      x: decoration.x,
      y: decoration.y,
    })),
    spawns,
    lighting: room.lighting.map(toRuntimeLight),
    objects: [],
  };
}

function toRuntimeLight(light: SubRoom["lighting"][number]): RuntimeLight {
  if (light.type === "torch") {
    return {
      type: "torch",
      x: light.x,
      y: light.y,
      ...(light.objectId ? { objectId: light.objectId } : {}),
    };
  }
  return { type: "ambient", color: light.color, intensity: light.intensity };
}

function toRuntimeObject(object: WorldObject): RuntimeObject {
  const spriteByState: Record<string, string> = {};
  for (const state of Object.keys(object.states)) {
    spriteByState[state] = resolveStateSprite(object.states[state], object.sprite);
  }

  return {
    id: object.id,
    roomId: object.roomId,
    type: object.type,
    position: object.position,
    sprite: resolveStateSprite(object.states[object.initialState], object.sprite),
    spriteByState,
    initialState: object.initialState,
    interactable: object.interactable,
    ...(object.inventory ? { inventory: object.inventory } : {}),
    ...(object.lockedBy ? { lockedBy: object.lockedBy } : {}),
    ...(object.leadsTo ? { leadsTo: object.leadsTo } : {}),
    ...(object.distribution ? { distribution: object.distribution } : {}),
    ...(object.hidingSpot ? { hidingSpot: object.hidingSpot } : {}),
  };
}

function resolveStateSprite(state: SpriteState | undefined, fallback: string): string {
  if (typeof state === "string" && state.length > 0) {
    return state;
  }
  if (state && typeof state === "object" && state.sprite) {
    return state.sprite;
  }
  return fallback;
}

/**
 * Desempaqueta una capa RLE `[cantidad, tileId, ...]` en una rejilla
 * fila-major de `expected` celdas. `0` se conserva como celda vacía.
 *
 * El contrato de 0.6 no obliga a que el RLE cubra la rejilla exacta (el fixture
 * del Rey Aldric no lo hace), así que las celdas que faltan se rellenan con `0`
 * y las sobrantes se descartan: la rejilla del modelo siempre mide
 * `cols × rows`. Un RLE con longitud impar o una cantidad negativa sí son
 * errores estructurales.
 */
function unpackRle(layer: TileLayer, expected: number, room: SubRoom): number[] {
  const { rle, name } = layer;

  if (rle.length % 2 !== 0) {
    throw new RoomPackageLoadError(
      `RoomPackage inválido: la capa "${name}" de la habitación "${room.id}" tiene un RLE con longitud impar (${rle.length}); debe ser [cantidad, tileId, ...].`,
    );
  }

  const tiles = new Array<number>(expected).fill(0);
  let cursor = 0;

  for (let i = 0; i < rle.length && cursor < expected; i += 2) {
    const count = rle[i]!;
    const tileId = rle[i + 1]!;
    if (count < 0) {
      throw new RoomPackageLoadError(
        `RoomPackage inválido: la capa "${name}" de la habitación "${room.id}" tiene una cantidad negativa (${count}) en su RLE.`,
      );
    }
    for (let n = 0; n < count && cursor < expected; n += 1) {
      tiles[cursor] = tileId;
      cursor += 1;
    }
  }

  return tiles;
}

function assertInGrid(room: RuntimeSubRoom, x: number, y: number, what: string): void {
  assertInGridById(room.id, room.width, room.height, x, y, what);
}

function assertInGridById(
  roomId: string,
  width: number,
  height: number,
  x: number,
  y: number,
  what: string,
): void {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
    throw new RoomPackageLoadError(
      `RoomPackage inválido: ${what} está en (${x}, ${y}), fuera de la rejilla ${width}×${height} de la habitación "${roomId}".`,
    );
  }
}

function indexById<T extends { id: string }>(values: T[]): Record<string, T> {
  const index: Record<string, T> = {};
  for (const value of values) {
    index[value.id] = value;
  }
  return index;
}
