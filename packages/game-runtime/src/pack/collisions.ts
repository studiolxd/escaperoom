import type { RuntimeObject, RuntimeSubRoom } from "../loader";
import { tileCollides } from "./frames";
import type { PackManifest } from "./manifest";

/**
 * Colisión por celda (specs/26 §4.1, ticket 1.2): una celda bloquea si alguna
 * de sus capas pinta un tile cuyo `collides` es `true` en el manifiesto, o si
 * la ocupa un objeto sólido. Las puertas no bloquean, para que los avatares
 * puedan atravesarlas.
 */

export interface CollisionGridOptions {
  /** Manifiesto del pack; sin él ningún tile colisiona (solo objetos). */
  manifest?: PackManifest;
  /** Si es `false`, los objetos no bloquean (por defecto `true`). */
  includeObjects?: boolean;
  /** Predicado de solidez por objeto; por defecto, todo menos las puertas. */
  objectBlocks?: (object: RuntimeObject) => boolean;
}

export interface CollisionGrid {
  width: number;
  height: number;
  /** Rejilla fila-major; `true` = celda bloqueada. */
  cells: boolean[];
  /** ¿Bloquea la celda `(tx, ty)`? Fuera de la rejilla también bloquea. */
  blocks(tx: number, ty: number): boolean;
  /** ¿Es transitable la celda `(tx, ty)`? */
  isWalkable(tx: number, ty: number): boolean;
}

/** Objeto sólido por defecto: todo menos las puertas (`leadsTo`). */
export function defaultObjectBlocks(object: RuntimeObject): boolean {
  return object.type !== "puerta" && !object.leadsTo;
}

/** Construye la rejilla de colisión de una `SubRoom` a partir del manifiesto. */
export function buildCollisionGrid(
  room: RuntimeSubRoom,
  options: CollisionGridOptions = {},
): CollisionGrid {
  const { manifest } = options;
  const includeObjects = options.includeObjects ?? true;
  const objectBlocks = options.objectBlocks ?? defaultObjectBlocks;

  const cells = new Array<boolean>(room.width * room.height).fill(false);
  const block = (x: number, y: number): void => {
    if (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < room.width &&
      y < room.height
    ) {
      cells[y * room.width + x] = true;
    }
  };

  for (const layer of room.layers) {
    for (let ty = 0; ty < room.height; ty += 1) {
      for (let tx = 0; tx < room.width; tx += 1) {
        const tileId = layer.tiles[ty * room.width + tx] ?? 0;
        if (tileId !== 0 && tileCollides(manifest, tileId)) {
          block(tx, ty);
        }
      }
    }
  }

  if (includeObjects) {
    for (const object of room.objects) {
      if (objectBlocks(object)) {
        block(Math.round(object.position.x), Math.round(object.position.y));
        for (const cell of object.footprint ?? []) {
          block(Math.round(cell.x), Math.round(cell.y));
        }
      }
    }
  }

  const blocks = (tx: number, ty: number): boolean => {
    if (
      !Number.isInteger(tx) ||
      !Number.isInteger(ty) ||
      tx < 0 ||
      ty < 0 ||
      tx >= room.width ||
      ty >= room.height
    ) {
      return true;
    }
    return cells[ty * room.width + tx] ?? true;
  };

  return {
    width: room.width,
    height: room.height,
    cells,
    blocks,
    isWalkable: (tx, ty) => !blocks(tx, ty),
  };
}
