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

/** Objeto sólido por defecto: todo menos las puertas (`leadsTo`) y las placas que se pisan. */
export function defaultObjectBlocks(object: RuntimeObject): boolean {
  return object.type !== "puerta" && !object.leadsTo && !object.stepOn;
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
    // Decoraciones sólidas (columnas, pilas de barriles…): puro dressing
    // visual sin contraparte en `objects`, pero marcadas `blocks: true` para
    // que bloqueen igual que un objeto sólido (revisión en vivo).
    for (const decoration of room.decorations) {
      if (decoration.blocks) {
        block(Math.round(decoration.x), Math.round(decoration.y));
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

/**
 * Avanza una posición continua (en celdas) `dx`/`dy` con colisión por celda,
 * eje a eje (primero X, luego Y, para deslizarse a lo largo de una pared).
 * Un eje solo se bloquea si el paso **entra** en otra celda que bloquea:
 * moverse dentro de la celda en la que ya se está siempre se permite.
 *
 * Sin esa excepción, un avatar colocado sobre una celda sólida (p. ej. una
 * placa de presión de `simultaneous_plates`, a la que el botón "Placa" del
 * panel lo lleva con `walkTo`) no podía salir nunca: con pasos de menos de
 * media celda (a 60 fps, 4 celdas/s ≈ 0,07 por frame) la celda redondeada de
 * destino seguía siendo la propia placa, así que cada paso se rechazaba y el
 * avatar se quedaba andando sin moverse (smoke E2E de la PR #187). Entrar en
 * una celda sólida desde fuera sigue siendo imposible.
 */
export function moveWithCollision(
  grid: Pick<CollisionGrid, "width" | "height" | "blocks">,
  position: { x: number; y: number },
  dx: number,
  dy: number,
): { x: number; y: number } {
  const clampTo = (value: number, max: number): number => Math.min(Math.max(value, 0), max);
  let { x, y } = position;

  const nextX = x + dx;
  const cellX = Math.round(nextX);
  if (cellX === Math.round(x) || !grid.blocks(cellX, Math.round(y))) {
    x = clampTo(nextX, grid.width - 1);
  }

  const nextY = y + dy;
  const cellY = Math.round(nextY);
  if (cellY === Math.round(y) || !grid.blocks(Math.round(x), cellY)) {
    y = clampTo(nextY, grid.height - 1);
  }

  return { x, y };
}
