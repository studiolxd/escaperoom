import type { Models3DCatalog } from "../packs";
import { positionFromTransform, type Piece3D, type RoomPackage, type SpriteState, type SubRoom, type WorldObject } from "../schemas";

/**
 * Conversor interno 2D → 3D (encargo 7.10b, specs/27 §11): convierte una sala 2D en una sala 3D
 * reproducible y determinista. Herramienta de desarrollo, no se expone en la web ni en el MCP.
 *
 * Notación: la celda `(cx, cy)` del 2D ocupa en 3D el cuadrado `[cx, cx+1] × [cy, cy+1]`; su centro
 * es `(cx + 0.5, cy + 0.5)`.
 */

export interface Convert3DOptions {
  /** `sprites2d` de tools/assets-generator/packs/medieval-v1/modelos3d.json. */
  sprites: Record<string, { model: string; yaw: number }>;
  /** `sinModelo` del mismo fichero: sprites que no son un modelo (el estado «no visible»). */
  hiddenSprites: readonly string[];
  /** tileId → modelo de pieza de kit. */
  tiles: Record<number, string>;
  catalog: Models3DCatalog;
  meta: { id: string; title: string };
}

/** tileIds de suelo y muro del pack `medieval-v1` → pieza del kit (specs/27 §4.1, brief 7.10b §1.1). */
export const MEDIEVAL_V1_TILE_PIECES: Readonly<Record<number, string>> = {
  1: "suelo-piedra-1",
  2: "suelo-piedra-2",
  3: "suelo-alfombra",
  10: "muro",
  20: "muro-arco",
  21: "muro-arco",
  22: "muro-arco",
};

const ARCH_MODEL = "muro-arco";
const TORCH_HEIGHT = 1.6;
/** Separación de un objeto de pared respecto a la cara del muro, y entre objetos de la misma celda. */
const WALL_OFFSET_BASE = 0.01;
const WALL_OFFSET_STEP = 0.02;

/** Direcciones de la «cara interior», en orden de preferencia, y el giro que mira hacia dentro. */
const FACE_DIRECTIONS = [
  { dx: 0, dy: 1, yaw: 0 },
  { dx: 1, dy: 0, yaw: 90 },
  { dx: 0, dy: -1, yaw: 180 },
  { dx: -1, dy: 0, yaw: 270 },
] as const;

type Face = { dx: number; dy: number; yaw: number };

function decodeRle(rle: readonly number[], size: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < rle.length; i += 2) {
    for (let n = 0; n < rle[i]!; n += 1) out.push(rle[i + 1]!);
  }
  while (out.length < size) out.push(0);
  return out.slice(0, size);
}

class RoomGrid {
  private readonly ground: number[];
  private readonly walls: number[];
  readonly cols: number;
  readonly rows: number;

  constructor(readonly room: SubRoom) {
    this.cols = room.grid.cols;
    this.rows = room.grid.rows;
    const size = this.cols * this.rows;
    const layer = (name: string): number[] => {
      const found = room.layers.find((l) => l.name === name);
      return found ? decodeRle(found.rle, size) : new Array<number>(size).fill(0);
    };
    this.ground = layer("ground");
    this.walls = layer("walls");
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }
  groundAt(x: number, y: number): number {
    return this.inside(x, y) ? this.ground[y * this.cols + x]! : 0;
  }
  wallAt(x: number, y: number): number {
    return this.inside(x, y) ? this.walls[y * this.cols + x]! : 0;
  }
  isWall(x: number, y: number): boolean {
    return this.wallAt(x, y) !== 0;
  }

  /** Primera dirección cuya celda vecina existe y no es muro; el giro mira hacia dentro. */
  interiorFace(x: number, y: number): Face | undefined {
    return FACE_DIRECTIONS.find((f) => this.inside(x + f.dx, y + f.dy) && !this.isWall(x + f.dx, y + f.dy));
  }
}

function cellOf(value: number): number {
  return Math.floor(value);
}

export function convertRoomTo3D(pkg: RoomPackage, options: Convert3DOptions): RoomPackage {
  const hidden = new Set(options.hiddenSprites);
  const grids = new Map(pkg.map.rooms.map((room) => [room.id, new RoomGrid(room)]));
  let pieceCounter = 0;
  const nextPieceId = (): string => `p-${(pieceCounter++).toString(36).padStart(8, "0")}`;

  const spriteEntry = (sprite: string, what: string): { model: string; yaw: number } => {
    const entry = Object.hasOwn(options.sprites, sprite) ? options.sprites[sprite] : undefined;
    if (!entry) throw new Error(`Sin modelo 3D para el sprite «${sprite}» (${what})`);
    return entry;
  };
  const tileModel = (tileId: number, roomId: string, x: number, y: number): string => {
    const model = Object.hasOwn(options.tiles, tileId) ? options.tiles[tileId] : undefined;
    if (!model) throw new Error(`El tileId ${tileId} de «${roomId}» en (${x}, ${y}) no tiene pieza de kit`);
    if (!Object.hasOwn(options.catalog.models, model)) {
      throw new Error(`La pieza «${model}» (tileId ${tileId}) no está en el catálogo del pack`);
    }
    return model;
  };

  const faceOf = (grid: RoomGrid, x: number, y: number, what: string): Face => {
    const face = grid.interiorFace(x, y);
    if (!face) throw new Error(`${what} en la celda (${x}, ${y}) de «${grid.room.id}» no tiene cara interior`);
    return face;
  };

  // ── Piezas: suelo, muros y decoraciones ────────────────────────────────────────────────────
  const world3dRooms: Record<string, { pieces: Piece3D[] }> = {};
  for (const room of pkg.map.rooms) {
    const grid = grids.get(room.id)!;
    const pieces: Piece3D[] = [];
    const put = (model: string, x: number, y: number, yaw: number): void => {
      pieces.push({ id: nextPieceId(), model, x, y, h: 0, yaw });
    };
    for (let y = 0; y < grid.rows; y += 1) {
      for (let x = 0; x < grid.cols; x += 1) {
        const wallTile = grid.wallAt(x, y);
        const groundTile = grid.groundAt(x, y);
        const isArch = wallTile !== 0 && tileModelOrUndefined(options.tiles, wallTile) === ARCH_MODEL;
        // Bajo un muro no hay suelo, salvo bajo un arco (se pisa el hueco).
        if (groundTile !== 0 && (wallTile === 0 || isArch)) {
          put(tileModel(groundTile, room.id, x, y), x + 0.5, y + 0.5, 0);
        }
        if (wallTile !== 0) {
          const model = tileModel(wallTile, room.id, x, y);
          let yaw = 0;
          if (model === ARCH_MODEL) yaw = grid.isWall(x - 1, y) || grid.isWall(x + 1, y) || !grid.inside(x - 1, y) || !grid.inside(x + 1, y) ? 0 : 90;
          put(model, x + 0.5, y + 0.5, yaw);
        }
      }
    }
    for (const decoration of room.decorations) {
      const entry = spriteEntry(decoration.sprite, `decoración de «${room.id}»`);
      put(entry.model, cellOf(decoration.x) + 0.5, cellOf(decoration.y) + 0.5, entry.yaw);
    }
    world3dRooms[room.id] = { pieces };
  }

  // ── Objetos ────────────────────────────────────────────────────────────────────────────────
  const wallObjectsPlaced = new Map<string, number>();
  const convertSprite = (sprite: string, what: string): string =>
    hidden.has(sprite) ? sprite : spriteEntry(sprite, what).model;
  const convertState = (state: SpriteState, objectId: string): SpriteState => {
    if (typeof state === "string") return convertSprite(state, `estado de «${objectId}»`);
    return state.sprite === undefined
      ? state
      : { ...state, sprite: convertSprite(state.sprite, `estado de «${objectId}»`) };
  };

  const objects: WorldObject[] = pkg.objects.map((object) => {
    const grid = grids.get(object.roomId);
    if (!grid) throw new Error(`El objeto «${object.id}» está en la habitación «${object.roomId}», que no existe`);
    const cx = object.position.x;
    const cy = object.position.y;
    const entry = hidden.has(object.sprite) ? { model: object.sprite, yaw: 0 } : spriteEntry(object.sprite, `objeto «${object.id}»`);
    const isDoor = object.leadsTo !== undefined || object.type === "puerta";

    let transform: { x: number; y: number; h: number; yaw: number };
    if (isDoor) {
      const face = faceOf(grid, cx, cy, `La puerta «${object.id}»`);
      transform = { x: cx + 0.5, y: cy + 0.5, h: 0, yaw: face.yaw };
    } else if (grid.isWall(cx, cy)) {
      const key = `${object.roomId}:${cx},${cy}`;
      const k = wallObjectsPlaced.get(key) ?? 0;
      wallObjectsPlaced.set(key, k + 1);
      const face = faceOf(grid, cx, cy, `El objeto de pared «${object.id}»`);
      const offset = 0.5 + WALL_OFFSET_BASE + WALL_OFFSET_STEP * k;
      transform = { x: round3(cx + 0.5 + offset * face.dx), y: round3(cy + 0.5 + offset * face.dy), h: 0, yaw: face.yaw };
    } else {
      const cells = [object.position, ...(object.footprint ?? [])];
      const xs = cells.map((c) => c.x);
      const ys = cells.map((c) => c.y);
      transform = {
        x: (Math.min(...xs) + Math.max(...xs)) / 2 + 0.5,
        y: (Math.min(...ys) + Math.max(...ys)) / 2 + 0.5,
        h: 0,
        yaw: entry.yaw,
      };
    }

    const converted: WorldObject = {
      ...object,
      sprite: entry.model,
      states: Object.fromEntries(Object.entries(object.states).map(([name, state]) => [name, convertState(state, object.id)])),
      position: positionFromTransform(transform),
      transform,
    };
    delete converted.footprint;
    return converted;
  });

  // ── Habitaciones: aparición y luces ────────────────────────────────────────────────────────
  const rooms: SubRoom[] = pkg.map.rooms.map((room) => {
    const grid = grids.get(room.id)!;
    return {
      ...room,
      layers: [],
      decorations: [],
      spawnPoints: room.spawnPoints.map((spawn) => ({ ...spawn, x: spawn.x + 0.5, y: spawn.y + 0.5, h: 0, yaw: 0 })),
      lighting: room.lighting.map((light) => {
        if (light.type !== "torch") return light;
        const x = cellOf(light.x);
        const y = cellOf(light.y);
        if (grid.isWall(x, y)) {
          const face = faceOf(grid, x, y, "La antorcha");
          return { ...light, x: x + 0.5 + 0.5 * face.dx, y: y + 0.5 + 0.5 * face.dy, h: TORCH_HEIGHT };
        }
        return { ...light, x: x + 0.5, y: y + 0.5, h: TORCH_HEIGHT };
      }),
    };
  });

  // ── Puzles: solo cambian las coordenadas de placas y escondites ────────────────────────────
  const puzzles = pkg.puzzles.map((puzzle) => {
    if (puzzle.type === "simultaneous_plates") {
      return { ...puzzle, plates: puzzle.plates.map((plate) => ({ ...plate, x: plate.x + 0.5, y: plate.y + 0.5 })) };
    }
    if (puzzle.type === "hidden_key") {
      const spot = { ...puzzle.hidingSpot };
      if (spot.x !== undefined) spot.x += 0.5;
      if (spot.y !== undefined) spot.y += 0.5;
      // `puzzle.position` es un `PositionSchema` (enteros de celda): se deja igual.
      return { ...puzzle, hidingSpot: spot };
    }
    return puzzle;
  });

  const { intro, ...metaRest } = pkg.meta;
  const meta: RoomPackage["meta"] = { ...metaRest, id: options.meta.id, title: options.meta.title, dimension: "3d" };
  // Solo se conserva una intro de texto, y sin narración (el audio referencia assets).
  if (intro?.type === "text") {
    meta.intro = { type: "text", text: intro.text };
  }

  return {
    ...pkg,
    meta,
    map: { ...pkg.map, rooms },
    objects,
    puzzles,
    world3d: { rooms: world3dRooms, models: {} },
  };
}

function tileModelOrUndefined(tiles: Record<number, string>, tileId: number): string | undefined {
  return Object.hasOwn(tiles, tileId) ? tiles[tileId] : undefined;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
