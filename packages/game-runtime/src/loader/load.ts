import {
  RoomPackageSchema,
  formatRoomPackageError,
  toReadableIssues,
  type LocalizedText,
  type PuzzleDefinition,
  type RoomPackage,
  type Rule,
  type SpriteState,
  type SubRoom,
  type TileLayer,
  type WorldObject,
} from "@escaperoom/shared/schemas";
import { RoomPackageLoadError } from "./errors";
import type {
  RuntimeDialog,
  RuntimeHint,
  RuntimeItem,
  RuntimeLight,
  RuntimeModel,
  RuntimeObject,
  RuntimeObjectAction,
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
  const inspections = buildInspectionIndex(roomPackage.rules);
  const actions = buildActionIndex(roomPackage.rules);

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

    const runtimeObject: RuntimeObject = {
      ...toRuntimeObject(object, inspections[object.id]),
      actions: actions[object.id] ?? ["inspect", "use_item"],
    };
    const panelPuzzleId = panelForObject(roomPackage, object);
    if (panelPuzzleId) runtimeObject.panelPuzzleId = panelPuzzleId;
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

  const puzzles: RuntimePuzzle[] = roomPackage.puzzles.map(toRuntimePuzzle);

  const hints: RuntimeHint[] = roomPackage.hints
    .map((hint) => ({ puzzleId: hint.puzzleId, tier: hint.tier, cost: hint.cost }))
    .sort((a, b) => a.puzzleId.localeCompare(b.puzzleId) || a.tier - b.tier);

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
    hints,
  };
}

/**
 * Resumen público de un puzzle: dependencias y, para las mecánicas de
 * posición, dónde están las placas/mirillas; para un `split_clue` de
 * símbolos, su paleta (glifos distintos, ordenados). Nunca `code`, `solution`,
 * `recipes`, `seed`, `pairs`, `fragments` ni testigos.
 */
function toRuntimePuzzle(puzzle: PuzzleDefinition): RuntimePuzzle {
  const base: RuntimePuzzle = {
    id: puzzle.id,
    type: puzzle.type,
    roomId: puzzle.roomId,
    layer: puzzle.layer,
    requiresSolved: puzzle.requiresSolved,
    unlocks: puzzle.unlocks,
    grantsItems: puzzle.grantsItems,
  };
  if (puzzle.type === "simultaneous_plates") {
    base.plates = puzzle.plates.map(({ objectId, x, y }) => ({ objectId, x, y }));
    if (puzzle.soloBridgeItemId) base.soloBridgeItemId = puzzle.soloBridgeItemId;
  } else if (puzzle.type === "split_clue") {
    base.viewpoints = puzzle.viewpoints.map(({ objectId, zone }) => ({
      objectId,
      x: zone.x,
      y: zone.y,
    }));
    if (puzzle.inputUI === "symbols") base.symbols = [...new Set(puzzle.fragments)].sort();
    if (puzzle.soloBridgeItemId) base.soloBridgeItemId = puzzle.soloBridgeItemId;
  }
  return base;
}

/** Acciones de menú por objeto a partir de los tipos de trigger (specs/05 §3). */
function buildActionIndex(rules: readonly Rule[]): Record<string, RuntimeObjectAction[]> {
  const index: Record<string, RuntimeObjectAction[]> = {};
  for (const rule of rules) {
    const action: RuntimeObjectAction | undefined =
      rule.trigger.type === "on_interact"
        ? "inspect"
        : rule.trigger.type === "on_use_item"
          ? "use_item"
          : undefined;
    if (!action || !("objectId" in rule.trigger)) continue;
    const list = (index[rule.trigger.objectId] ??= []);
    if (!list.includes(action)) list.push(action);
  }
  return index;
}

/** Mismo criterio que `RoomSession.panelForObject` (escondite, `lockedBy`, mirilla). */
function panelForObject(roomPackage: RoomPackage, object: WorldObject): string | undefined {
  const hiding = roomPackage.puzzles.find(
    (puzzle) => puzzle.type === "hidden_key" && puzzle.hidingSpot.objectId === object.id,
  );
  if (hiding) return hiding.id;
  if (object.lockedBy) return object.lockedBy;
  return roomPackage.puzzles.find(
    (puzzle) =>
      puzzle.type === "split_clue" &&
      puzzle.viewpoints.some((viewpoint) => viewpoint.objectId === object.id),
  )?.id;
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

/** Inspección derivada de una regla `on_interact`, sin condiciones ni secretos. */
interface DerivedInspection {
  dialogId?: string;
  panelPuzzleId?: string;
  conditioned?: boolean;
}

function toRuntimeObject(object: WorldObject, inspection?: DerivedInspection): RuntimeObject {
  const spriteByState: Record<string, string> = {};
  const animationByState: Record<string, string> = {};
  const states = Object.keys(object.states);

  for (const state of states) {
    const value = object.states[state];
    spriteByState[state] = resolveStateSprite(value, object.sprite);
    const animation = resolveStateAnimation(value);
    if (animation) {
      animationByState[state] = animation;
    }
  }

  return {
    id: object.id,
    roomId: object.roomId,
    type: object.type,
    position: object.position,
    sprite: resolveStateSprite(object.states[object.initialState], object.sprite),
    states,
    spriteByState,
    ...(Object.keys(animationByState).length > 0 ? { animationByState } : {}),
    initialState: object.initialState,
    interactable: object.interactable,
    ...(object.inventory ? { inventory: object.inventory } : {}),
    ...(object.lockedBy ? { lockedBy: object.lockedBy } : {}),
    ...(object.leadsTo ? { leadsTo: object.leadsTo } : {}),
    ...(object.distribution ? { distribution: object.distribution } : {}),
    ...(object.hidingSpot ? { hidingSpot: object.hidingSpot } : {}),
    ...(inspection?.dialogId ? { inspectDialogId: inspection.dialogId } : {}),
    ...(inspection?.panelPuzzleId ? { inspectPanelPuzzleId: inspection.panelPuzzleId } : {}),
    ...(inspection?.conditioned ? { inspectConditioned: true } : {}),
  };
}

/**
 * Construye un índice `objectId → inspección` a partir de las reglas
 * `on_interact`. Se prefiere la primera regla **incondicional** con
 * `show_dialog`/`open_panel_puzzle`; si no hay, la primera condicionada. Así el
 * runtime puede mostrar la descripción del objeto sin ejecutar reglas, y el
 * motor de 1.4 decide cuándo aplican las acciones.
 */
function buildInspectionIndex(rules: Rule[]): Record<string, DerivedInspection> {
  interface Choice {
    id: string;
    conditioned: boolean;
  }
  const index: Record<string, { dialog?: Choice; panel?: Choice }> = {};

  for (const rule of rules) {
    if (rule.trigger.type !== "on_interact") {
      continue;
    }
    const { objectId } = rule.trigger;
    const dialogId = firstAction(rule, "show_dialog")?.dialogId;
    const panelPuzzleId = firstAction(rule, "open_panel_puzzle")?.puzzleId;
    if (!dialogId && !panelPuzzleId) {
      continue;
    }

    const entry = (index[objectId] ??= {});
    const conditioned = rule.conditions.length > 0;
    if (dialogId && shouldReplace(entry.dialog, conditioned)) {
      entry.dialog = { id: dialogId, conditioned };
    }
    if (panelPuzzleId && shouldReplace(entry.panel, conditioned)) {
      entry.panel = { id: panelPuzzleId, conditioned };
    }
  }

  const result: Record<string, DerivedInspection> = {};
  for (const [objectId, entry] of Object.entries(index)) {
    result[objectId] = {
      ...(entry.dialog ? { dialogId: entry.dialog.id } : {}),
      ...(entry.panel ? { panelPuzzleId: entry.panel.id } : {}),
      ...(entry.dialog?.conditioned || entry.panel?.conditioned ? { conditioned: true } : {}),
    };
  }
  return result;
}

function shouldReplace(
  current: { conditioned: boolean } | undefined,
  nextConditioned: boolean,
): boolean {
  if (!current) {
    return true;
  }
  return current.conditioned && !nextConditioned;
}

function firstAction<T extends Rule["actions"][number]["type"]>(
  rule: Rule,
  type: T,
): Extract<Rule["actions"][number], { type: T }> | undefined {
  return rule.actions.find(
    (action): action is Extract<Rule["actions"][number], { type: T }> => action.type === type,
  );
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

function resolveStateAnimation(state: SpriteState | undefined): string | undefined {
  if (state && typeof state === "object" && state.animation) {
    return state.animation;
  }
  return undefined;
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
