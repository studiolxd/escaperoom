import * as Y from "yjs";
import type { Decoration, LightConfig } from "@escaperoom/shared/schemas";
import { collection, plain, type RecordMap } from "./doc-model";
import { assertInside, RoomDocError, subRoom, type Cell } from "./commands";

/**
 * Decoración e iluminación de una habitación interna (`SubRoom.decorations` y
 * `SubRoom.lighting`, specs/08 §2.1 y specs/04 §3.3–3.4). Viven en el doc como
 * `Y.Array<JSON>` dentro de la entrada de la habitación (forma de 3.1), así que
 * `roomDocToPackage` las exporta tal cual y la ida y vuelta RoomPackage ⇄ doc
 * sigue siendo exacta.
 *
 * Las entradas no tienen id en el formato: se direccionan por su índice en la
 * lista. Cada comando es UNA transacción y lo usan igual el editor (palette,
 * herramientas `decorate`/`torch`, panel de la sala) y el MCP
 * (`decorate_subroom`).
 */

type Torch = Extract<LightConfig, { type: "torch" }>;
type Ambient = Extract<LightConfig, { type: "ambient" }>;

/** Color de la luz ambiente: `#rrggbb` (lo que produce `<input type="color">`). */
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function listOf(room: RecordMap, key: "decorations" | "lighting"): Y.Array<unknown> {
  const list = room.get(key);
  if (list instanceof Y.Array) return list as Y.Array<unknown>;
  const created = new Y.Array<unknown>();
  room.set(key, created);
  return created;
}

function readList<T>(doc: Y.Doc, roomId: string, key: "decorations" | "lighting"): T[] {
  const list = subRoom(doc, roomId).get(key);
  return list instanceof Y.Array ? (list.toJSON() as T[]) : [];
}

/** Sustituye la entrada `index` de la lista (borrar + insertar en la misma posición). */
function replaceAt(list: Y.Array<unknown>, index: number, value: unknown): void {
  list.delete(index, 1);
  list.insert(index, [plain(value)]);
}

function assertIndex(list: Y.Array<unknown>, index: number, what: "decoration" | "light"): void {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    throw new RoomDocError(
      what === "decoration" ? "UNKNOWN_DECORATION" : "UNKNOWN_LIGHT",
      what === "decoration"
        ? `No existe la decoración #${index} (hay ${list.length})`
        : `No existe la luz #${index} (hay ${list.length})`,
    );
  }
}

function assertSprite(sprite: string): void {
  if (typeof sprite !== "string" || sprite.trim() === "") {
    throw new RoomDocError("INVALID_VALUE", "La decoración necesita un sprite");
  }
}

// ---------------------------------------------------------------------------
// Decoración
// ---------------------------------------------------------------------------

/** Decoraciones de la habitación, en orden. */
export function listDecorations(doc: Y.Doc, roomId: string): Decoration[] {
  return readList<Decoration>(doc, roomId, "decorations");
}

function checkDecoration(doc: Y.Doc, roomId: string, decoration: Decoration): Decoration {
  assertSprite(decoration.sprite);
  assertInside(doc, roomId, decoration);
  return { sprite: decoration.sprite, x: decoration.x, y: decoration.y };
}

/** Coloca una decoración (sprite de la palette) en una celda. Devuelve su índice. */
export function addDecoration(doc: Y.Doc, roomId: string, decoration: Decoration): number {
  let index = -1;
  doc.transact(() => {
    const list = listOf(subRoom(doc, roomId), "decorations");
    list.push([plain(checkDecoration(doc, roomId, decoration))]);
    index = list.length - 1;
  });
  return index;
}

/** Mueve la decoración `index` a otra celda. `false` si ya estaba ahí. */
export function moveDecoration(doc: Y.Doc, roomId: string, index: number, cell: Cell): boolean {
  let moved = false;
  doc.transact(() => {
    const list = listOf(subRoom(doc, roomId), "decorations");
    assertIndex(list, index, "decoration");
    const current = list.get(index) as Decoration;
    if (current.x === cell.x && current.y === cell.y) return;
    replaceAt(list, index, checkDecoration(doc, roomId, { ...current, x: cell.x, y: cell.y }));
    moved = true;
  });
  return moved;
}

/** Cambia el sprite de la decoración `index`. */
export function setDecorationSprite(
  doc: Y.Doc,
  roomId: string,
  index: number,
  sprite: string,
): void {
  doc.transact(() => {
    const list = listOf(subRoom(doc, roomId), "decorations");
    assertIndex(list, index, "decoration");
    const current = list.get(index) as Decoration;
    if (current.sprite === sprite) return;
    replaceAt(list, index, checkDecoration(doc, roomId, { ...current, sprite }));
  });
}

export function removeDecoration(doc: Y.Doc, roomId: string, index: number): void {
  doc.transact(() => {
    const list = listOf(subRoom(doc, roomId), "decorations");
    assertIndex(list, index, "decoration");
    list.delete(index, 1);
  });
}

/**
 * Sustituye TODAS las decoraciones de la habitación (en el orden dado). Es la
 * variante declarativa para quien trae la lista entera (MCP, 4.2).
 */
export function setDecorations(
  doc: Y.Doc,
  roomId: string,
  decorations: readonly Decoration[],
): void {
  doc.transact(() => {
    const room = subRoom(doc, roomId);
    const checked = decorations.map((decoration) => checkDecoration(doc, roomId, decoration));
    const list = listOf(room, "decorations");
    if (JSON.stringify(list.toJSON()) === JSON.stringify(checked)) return;
    list.delete(0, list.length);
    list.push(plain(checked));
  });
}

// ---------------------------------------------------------------------------
// Iluminación
// ---------------------------------------------------------------------------

/** Luces de la habitación (antorchas y ambiente), en orden. */
export function listLights(doc: Y.Doc, roomId: string): LightConfig[] {
  return readList<LightConfig>(doc, roomId, "lighting");
}

/** Luz ambiente de la habitación (la primera, la que pinta el runtime), o `undefined`. */
export function getAmbientLight(doc: Y.Doc, roomId: string): Ambient | undefined {
  return listLights(doc, roomId).find((light): light is Ambient => light.type === "ambient");
}

function checkTorch(doc: Y.Doc, roomId: string, torch: Omit<Torch, "type">): Torch {
  assertInside(doc, roomId, torch);
  if (torch.objectId !== undefined && !collection(doc, "objects").has(torch.objectId)) {
    throw new RoomDocError(
      "UNKNOWN_OBJECT",
      `No existe el objeto "${torch.objectId}" que gobierna la antorcha`,
    );
  }
  return {
    type: "torch",
    x: torch.x,
    y: torch.y,
    ...(torch.objectId !== undefined ? { objectId: torch.objectId } : {}),
  };
}

function checkAmbient(ambient: Omit<Ambient, "type">): Ambient {
  if (!COLOR_PATTERN.test(ambient.color)) {
    throw new RoomDocError(
      "INVALID_VALUE",
      `El color de la luz ambiente debe ser #rrggbb (recibido "${ambient.color}")`,
    );
  }
  if (!Number.isFinite(ambient.intensity) || ambient.intensity < 0 || ambient.intensity > 1) {
    throw new RoomDocError(
      "INVALID_VALUE",
      `La intensidad de la luz ambiente va de 0 a 1 (recibido ${ambient.intensity})`,
    );
  }
  return { type: "ambient", color: ambient.color, intensity: ambient.intensity };
}

function checkLight(doc: Y.Doc, roomId: string, light: LightConfig): LightConfig {
  return light.type === "torch" ? checkTorch(doc, roomId, light) : checkAmbient(light);
}

/**
 * Coloca una antorcha en una celda, opcionalmente gobernada por un objeto
 * (encendida/apagada según su estado, specs/04 §3.4). Devuelve su índice.
 */
export function addTorch(doc: Y.Doc, roomId: string, torch: Omit<Torch, "type">): number {
  let index = -1;
  doc.transact(() => {
    const list = listOf(subRoom(doc, roomId), "lighting");
    list.push([plain(checkTorch(doc, roomId, torch))]);
    index = list.length - 1;
  });
  return index;
}

export type TorchPatch = {
  x?: number;
  y?: number;
  /** `null` desliga la antorcha de su objeto. */
  objectId?: string | null;
};

/** Mueve la antorcha `index` o cambia el objeto que la gobierna. */
export function updateTorch(doc: Y.Doc, roomId: string, index: number, patch: TorchPatch): void {
  doc.transact(() => {
    const list = listOf(subRoom(doc, roomId), "lighting");
    assertIndex(list, index, "light");
    const current = list.get(index) as LightConfig;
    if (current.type !== "torch") {
      throw new RoomDocError("UNKNOWN_LIGHT", `La luz #${index} no es una antorcha`);
    }
    const objectId = patch.objectId === null ? undefined : (patch.objectId ?? current.objectId);
    const next = checkTorch(doc, roomId, {
      x: patch.x ?? current.x,
      y: patch.y ?? current.y,
      ...(objectId !== undefined ? { objectId } : {}),
    });
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    replaceAt(list, index, next);
  });
}

/** Quita la luz `index` (antorcha o ambiente). */
export function removeLight(doc: Y.Doc, roomId: string, index: number): void {
  doc.transact(() => {
    const list = listOf(subRoom(doc, roomId), "lighting");
    assertIndex(list, index, "light");
    list.delete(index, 1);
  });
}

/**
 * Fija la luz ambiente (color + intensidad): sustituye en su sitio la que ya
 * hubiera o la añade al final. `null` la quita.
 */
export function setAmbientLight(
  doc: Y.Doc,
  roomId: string,
  ambient: Omit<Ambient, "type"> | null,
): void {
  doc.transact(() => {
    const list = listOf(subRoom(doc, roomId), "lighting");
    const lights = list.toJSON() as LightConfig[];
    if (ambient === null) {
      for (let i = lights.length - 1; i >= 0; i--) {
        if (lights[i]?.type === "ambient") list.delete(i, 1);
      }
      return;
    }
    const next = checkAmbient(ambient);
    const index = lights.findIndex((light) => light.type === "ambient");
    if (index === -1) list.push([plain(next)]);
    else if (JSON.stringify(lights[index]) !== JSON.stringify(next)) replaceAt(list, index, next);
  });
}

/**
 * Sustituye TODA la iluminación de la habitación (en el orden dado). Variante
 * declarativa para quien trae la lista entera (MCP, 4.2).
 */
export function setLighting(doc: Y.Doc, roomId: string, lighting: readonly LightConfig[]): void {
  doc.transact(() => {
    const room = subRoom(doc, roomId);
    const checked = lighting.map((light) => checkLight(doc, roomId, light));
    const list = listOf(room, "lighting");
    if (JSON.stringify(list.toJSON()) === JSON.stringify(checked)) return;
    list.delete(0, list.length);
    list.push(plain(checked));
  });
}
