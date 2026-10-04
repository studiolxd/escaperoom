import type { Models3DCatalog } from "@escaperoom/shared/packs";
import {
  parseRoomPackage,
  type Collider3D,
  type RoomPackage,
  type WorldObject,
} from "@escaperoom/shared/schemas";

type Entry = Models3DCatalog["models"][string];

function entry(size: { w: number; d: number; hgt: number }, colliders: Collider3D[]): Entry {
  return {
    file: "models/x.glb",
    category: "suelto",
    label: { es: { text: "x" } },
    size,
    colliders,
    snap: false,
    clips: [],
  };
}

/** Caja con la base en h = 0 y origen en el centro de la base. */
function box(sx: number, sy: number, sh: number): Collider3D {
  return { type: "box", cx: 0, cy: 0, ch: sh / 2, sx, sy, sh };
}

/** Catálogo de prueba hecho a mano (brief 7.4 §1.5). */
export const TEST_CATALOG: Models3DCatalog = {
  packId: "test-v1",
  version: "1",
  avatars: {},
  models: {
    // Suelo: origen en el centro de la cara superior (que queda a h = 0).
    suelo: entry({ w: 1, d: 1, hgt: 0.1 }, [
      { type: "box", cx: 0, cy: 0, ch: -0.05, sx: 1, sy: 1, sh: 0.1 },
    ]),
    muro: entry({ w: 1, d: 1, hgt: 2.4 }, [box(1, 1, 2.4)]),
    escalon: entry({ w: 1, d: 1, hgt: 0.2 }, [box(1, 1, 0.2)]),
    tarima: entry({ w: 1, d: 1, hgt: 0.4 }, [box(1, 1, 0.4)]),
    rampa: entry({ w: 1, d: 2, hgt: 0.4 }, [
      { type: "ramp", cx: 0, cy: 0, sx: 1, sy: 2, h0: 0, h1: 0.4, dir: "y+" },
    ]),
    // Sin colisionador: ni bloquea ni se pisa.
    alfombra: entry({ w: 1, d: 1, hgt: 0.02 }, []),
  },
};

export interface TestPiece {
  model: string;
  x: number;
  y: number;
  h?: number;
  yaw?: number;
  scale?: number;
}

let counter = 0;
const pieceId = () => `p-${(counter++).toString(36).padStart(8, "0")}`;

/** Suelo de `w × d` m hecho de baldosas `suelo` de 1 m. */
export function floor(w: number, d: number): TestPiece[] {
  const tiles: TestPiece[] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) tiles.push({ model: "suelo", x: i + 0.5, y: j + 0.5 });
  return tiles;
}

export function testObject(
  over: Partial<WorldObject> & Pick<WorldObject, "id"> & { at?: { x: number; y: number } },
): WorldObject {
  const { at, ...rest } = over;
  const x = at?.x ?? 1;
  const y = at?.y ?? 1;
  return {
    roomId: "sala",
    type: "mueble",
    position: { x: Math.round(x), y: Math.round(y) },
    transform: { x, y, h: 0, yaw: 0 },
    sprite: "muro",
    states: { a: "muro" },
    initialState: "a",
    interactable: false,
    ...rest,
  };
}

/** `RoomPackage` 3D mínimo con una habitación `sala` de 20 × 20 m. */
export function room(
  pieces: TestPiece[],
  objects: WorldObject[] = [],
  plateObjectIds: string[] = [],
): RoomPackage {
  return parseRoomPackage({
    meta: {
      id: "sala-nav",
      title: "Sala de navegación",
      authorId: "autora",
      version: "1.0.0",
      packageFormat: "roompackage/v1",
      theme: "medieval",
      description: "Sala de prueba de la navmesh",
      languages: ["es"],
      defaultLanguage: "es",
      estimatedMinutes: 2,
      timeLimitMinutes: 10,
      difficulty: 1,
      players: { min: 1, max: 1 },
      assetsManifest: "r2://assets/packs/medieval-v1/manifest.json",
      dimension: "3d",
    },
    map: {
      tileset: "medieval-v1",
      rooms: [
        {
          id: "sala",
          name: "Sala",
          grid: { cols: 20, rows: 20 },
          layers: [],
          decorations: [],
          spawnPoints: [{ id: "spawn-1", x: 1, y: 1, h: 0, yaw: 0 }],
          lighting: [{ type: "ambient", color: "#ffffff", intensity: 1 }],
        },
      ],
    },
    objects,
    items: [],
    puzzles:
      plateObjectIds.length === 0
        ? []
        : [
            {
              id: "placas",
              type: "simultaneous_plates",
              plates: plateObjectIds.map((objectId) => ({ objectId, x: 1, y: 1 })),
              windowMs: 1000,
              holdMode: "stand",
              layer: "world",
              roomId: "sala",
              requiresSolved: [],
              grantsItems: [],
              unlocks: [],
            },
          ],
    rules: [],
    dialogs: [],
    hints: [],
    world3d: {
      rooms: {
        sala: { pieces: pieces.map((p) => ({ id: pieceId(), h: 0, yaw: 0, ...p })) },
      },
      models: {},
    },
  });
}

