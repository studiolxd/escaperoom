import * as Y from "yjs";
import {
  ID_PATTERN,
  MAX_SCALE_3D,
  MAX_WORLD3D_HEIGHT,
  MAX_WORLD3D_PIECES_PER_ROOM,
  MIN_SCALE_3D,
  positionFromTransform,
  type Grid,
  type Piece3D,
  type Transform3D,
  type WorldObject,
} from "@escaperoom/shared/schemas";
import {
  RoomDocError,
  assertDimension,
  assertFreeId,
  proposeObjectId,
  subRoom,
} from "./commands";
import { setSubRoomGrid } from "./content";
import {
  buildFlatRecord,
  collection,
  nextOrder,
  orderedIds,
  readFlatRecord,
  type RecordMap,
} from "./doc-model";

/**
 * Comandos del mundo 3D sobre el doc Yjs (specs/27 §8.1, encargo 7.1b). Los
 * usan igual el editor 3D y el MCP. Todos exigen una sala 3D y son UNA
 * transacción; las piezas viven en `pieces3d`, una colección plana por id.
 */

export type Piece3DInput = Omit<Piece3D, "id">;

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** `"p-"` + 8 caracteres `[a-z0-9]` aleatorios, libre en el documento. */
export function newPieceId(doc: Y.Doc): string {
  const pieces = collection(doc, "pieces3d");
  for (;;) {
    let id = "p-";
    for (let i = 0; i < 8; i += 1) id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
    if (!pieces.has(id)) return id;
  }
}

/** `x ∈ [0, cols]`, `y ∈ [0, rows]`, `h ∈ [0, MAX_WORLD3D_HEIGHT]`; si no, `OUT_OF_BOUNDS`. */
export function assertInside3D(
  doc: Y.Doc,
  roomId: string,
  p: { x: number; y: number; h?: number },
): void {
  const room = subRoom(doc, roomId);
  const cols = Number(room.get("cols") ?? 0);
  const rows = Number(room.get("rows") ?? 0);
  const h = p.h ?? 0;
  const ok =
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Number.isFinite(h) &&
    p.x >= 0 &&
    p.x <= cols &&
    p.y >= 0 &&
    p.y <= rows &&
    h >= 0 &&
    h <= MAX_WORLD3D_HEIGHT;
  if (!ok) {
    throw new RoomDocError(
      "OUT_OF_BOUNDS",
      `La posición (${p.x}, ${p.y}, h ${h}) está fuera de la habitación "${roomId}" (${cols}×${rows} m, altura máxima ${MAX_WORLD3D_HEIGHT} m)`,
    );
  }
}

function assertYaw(yaw: number): void {
  if (!Number.isFinite(yaw) || yaw < 0 || yaw >= 360) {
    throw new RoomDocError("INVALID_VALUE", `El giro (yaw = ${yaw}) debe estar en [0, 360)`);
  }
}

function assertScale(scale: number | undefined): void {
  if (scale === undefined) return;
  if (!Number.isFinite(scale) || scale < MIN_SCALE_3D || scale > MAX_SCALE_3D) {
    throw new RoomDocError(
      "INVALID_VALUE",
      `La escala (${scale}) debe estar entre ${MIN_SCALE_3D} y ${MAX_SCALE_3D}`,
    );
  }
}

function assertModelId(model: unknown, what = "model"): void {
  if (typeof model !== "string" || !ID_PATTERN.test(model)) {
    throw new RoomDocError("INVALID_ID", `"${String(model)}" no es un id de ${what} válido (a-z, 0-9 y guiones)`);
  }
}

function assertTransform(doc: Y.Doc, roomId: string, transform: Transform3D): void {
  assertInside3D(doc, roomId, transform);
  assertYaw(transform.yaw);
  assertScale(transform.scale);
}

function piecesOf(doc: Y.Doc, roomId: string): number {
  let count = 0;
  for (const piece of collection(doc, "pieces3d").values()) {
    if (piece.get("roomId") === roomId) count += 1;
  }
  return count;
}

function assertRoomCapacity(doc: Y.Doc, roomId: string, adding: number): void {
  if (piecesOf(doc, roomId) + adding > MAX_WORLD3D_PIECES_PER_ROOM) {
    throw new RoomDocError(
      "INVALID_VALUE",
      `La habitación "${roomId}" superaría el máximo de ${MAX_WORLD3D_PIECES_PER_ROOM} piezas`,
    );
  }
}

function checkPiece(doc: Y.Doc, roomId: string, piece: Piece3DInput): void {
  assertModelId(piece.model);
  assertInside3D(doc, roomId, piece);
  assertYaw(piece.yaw);
  assertScale(piece.scale);
}

function writePieces(doc: Y.Doc, roomId: string, pieces: readonly Piece3DInput[]): string[] {
  const map = collection(doc, "pieces3d");
  let order = nextOrder(map);
  const ids: string[] = [];
  for (const piece of pieces) {
    const id = newPieceId(doc);
    map.set(id, buildFlatRecord({ ...piece, roomId }, order++));
    ids.push(id);
  }
  return ids;
}

/** Medidas de la habitación en metros (= `setSubRoomGrid` sin capas). */
export function setRoomBounds3D(doc: Y.Doc, roomId: string, grid: Grid): void {
  assertDimension(doc, "3d", "setRoomBounds3D");
  setSubRoomGrid(doc, roomId, grid);
}

/** Añade piezas a la habitación; devuelve sus ids (en el orden dado). */
export function placePieces3D(
  doc: Y.Doc,
  roomId: string,
  pieces: readonly Piece3DInput[],
): string[] {
  let ids: string[] = [];
  doc.transact(() => {
    assertDimension(doc, "3d", "placePieces3D");
    subRoom(doc, roomId);
    for (const piece of pieces) checkPiece(doc, roomId, piece);
    assertRoomCapacity(doc, roomId, pieces.length);
    ids = writePieces(doc, roomId, pieces);
  });
  return ids;
}

/** Mueve, gira, escala o cambia de modelo una pieza (`UNKNOWN_PIECE` si no existe). */
export function updatePiece3D(
  doc: Y.Doc,
  pieceId: string,
  patch: Partial<Piece3DInput>,
): void {
  doc.transact(() => {
    assertDimension(doc, "3d", "updatePiece3D");
    const record = collection(doc, "pieces3d").get(pieceId);
    if (!record) throw new RoomDocError("UNKNOWN_PIECE", `No existe la pieza "${pieceId}"`);
    const roomId = String(record.get("roomId"));
    const current = readFlatRecord(record);
    const next = { ...current, ...patch } as Piece3DInput;
    checkPiece(doc, roomId, next);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) record.delete(key);
      else record.set(key, value);
    }
  });
}

/** Borra piezas (los ids que no existen se ignoran); devuelve cuántas se borraron. */
export function removePieces3D(doc: Y.Doc, pieceIds: readonly string[]): number {
  let removed = 0;
  doc.transact(() => {
    assertDimension(doc, "3d", "removePieces3D");
    const map = collection(doc, "pieces3d");
    for (const id of new Set(pieceIds)) {
      if (!map.has(id)) continue;
      map.delete(id);
      removed += 1;
    }
  });
  return removed;
}

/** Una pieza por celda del rectángulo (ambas esquinas incluidas), en `(i + 0.5, j + 0.5, h)`. */
export function fillPieces3D(
  doc: Y.Doc,
  roomId: string,
  input: {
    model: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
    h: number;
    yaw?: number;
  },
): string[] {
  let ids: string[] = [];
  doc.transact(() => {
    assertDimension(doc, "3d", "fillPieces3D");
    subRoom(doc, roomId);
    const { from, to } = input;
    for (const value of [from.x, from.y, to.x, to.y]) {
      if (!Number.isInteger(value)) {
        throw new RoomDocError("INVALID_VALUE", "Las esquinas del relleno son celdas enteras");
      }
    }
    const x0 = Math.min(from.x, to.x);
    const x1 = Math.max(from.x, to.x);
    const y0 = Math.min(from.y, to.y);
    const y1 = Math.max(from.y, to.y);
    const yaw = input.yaw ?? 0;
    const pieces: Piece3DInput[] = [];
    // Comprueba las esquinas antes de generar nada (un rectángulo enorme no debe asignar memoria).
    assertInside3D(doc, roomId, { x: x0 + 0.5, y: y0 + 0.5, h: input.h });
    assertInside3D(doc, roomId, { x: x1 + 0.5, y: y1 + 0.5, h: input.h });
    assertRoomCapacity(doc, roomId, (x1 - x0 + 1) * (y1 - y0 + 1));
    for (let j = y0; j <= y1; j += 1) {
      for (let i = x0; i <= x1; i += 1) {
        pieces.push({ model: input.model, x: i + 0.5, y: j + 0.5, h: input.h, yaw });
      }
    }
    for (const piece of pieces) checkPiece(doc, roomId, piece);
    ids = writePieces(doc, roomId, pieces);
  });
  return ids;
}

/** Piezas de una habitación (o de todas), en orden de alta. */
export function listPieces3D(doc: Y.Doc, roomId?: string): (Piece3D & { roomId: string })[] {
  const map = collection(doc, "pieces3d");
  const out: (Piece3D & { roomId: string })[] = [];
  for (const id of orderedIds(map)) {
    const flat = readFlatRecord(map.get(id) as RecordMap);
    if (roomId !== undefined && flat.roomId !== roomId) continue;
    out.push({ ...flat, id } as Piece3D & { roomId: string });
  }
  return out;
}

/** Como `placeObject`, con `transform`; `position` se deriva de él. Devuelve el id. */
export function placeObject3D(
  doc: Y.Doc,
  input: {
    roomId: string;
    sprite: string;
    transform: Transform3D;
    id?: string;
    type?: string;
    interactable?: boolean;
  },
): string {
  const id = input.id ?? proposeObjectId(doc, input.sprite, input.roomId);
  doc.transact(() => {
    assertDimension(doc, "3d", "placeObject3D");
    subRoom(doc, input.roomId);
    assertModelId(input.sprite, "sprite");
    assertTransform(doc, input.roomId, input.transform);
    assertFreeId(doc, id);
    const object: WorldObject = {
      id,
      roomId: input.roomId,
      type: input.type ?? "decorativo",
      position: positionFromTransform(input.transform),
      transform: { ...input.transform },
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

/** Mueve o gira un objeto (y opcionalmente lo pasa de habitación); actualiza `position`. */
export function setObjectTransform(
  doc: Y.Doc,
  objectId: string,
  transform: Transform3D,
  roomId?: string,
): void {
  doc.transact(() => {
    assertDimension(doc, "3d", "setObjectTransform");
    const record = collection(doc, "objects").get(objectId);
    if (!record) throw new RoomDocError("UNKNOWN_OBJECT", `No existe el objeto "${objectId}"`);
    const target = roomId ?? String(record.get("roomId"));
    subRoom(doc, target);
    assertTransform(doc, target, transform);
    record.set("transform", { ...transform });
    record.set("position", positionFromTransform(transform));
    if (target !== record.get("roomId")) record.set("roomId", target);
  });
}

/** Sustituye los puntos de aparición de la habitación. */
export function setSpawnPoints3D(
  doc: Y.Doc,
  roomId: string,
  spawns: readonly { id: string; x: number; y: number; h: number; yaw: number }[],
): void {
  doc.transact(() => {
    assertDimension(doc, "3d", "setSpawnPoints3D");
    const room = subRoom(doc, roomId);
    for (const spawn of spawns) {
      assertInside3D(doc, roomId, spawn);
      assertYaw(spawn.yaw);
    }
    const list = new Y.Array<unknown>();
    list.push(spawns.map((spawn) => ({ ...spawn })));
    room.set("spawnPoints", list);
  });
}
