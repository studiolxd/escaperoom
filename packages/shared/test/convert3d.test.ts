import { describe, expect, it } from "vitest";
import { convertRoomTo3D, MEDIEVAL_V1_TILE_PIECES, type Convert3DOptions } from "../src/convert3d/convert";
import { getModels3DCatalog } from "../src/packs";
import { parseRoomPackage, type RoomPackage } from "../src/schemas";
import { validateRoomPackage } from "../src/validator";

/**
 * Reglas del conversor 2D → 3D (encargo 7.10b §1.1) sobre una sala 2D pequeña de 7×5 celdas:
 *
 *   y0  # # # # A # #     `A` = arco (tile 20) en el muro norte (x = 4)
 *   y1  # . . # . . #     muro interior vertical en x = 3 (y = 1..3) con un arco (tile 21) en (3, 2)
 *   y2  # . . A . . #
 *   y3  # . . # . . #
 *   y4  # # # # # # #
 */

const W = 7;
const H = 5;

const WALLS = [
  [10, 10, 10, 10, 20, 10, 10],
  [10, 0, 0, 10, 0, 0, 10],
  [10, 0, 0, 21, 0, 0, 10],
  [10, 0, 0, 10, 0, 0, 10],
  [10, 10, 10, 10, 10, 10, 10],
];

function rle(values: number[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (out.length > 0 && out[out.length - 1] === v) out[out.length - 2]! += 1;
    else out.push(1, v);
  }
  return out;
}

const ground = new Array<number>(W * H).fill(1);
ground[1 * W + 1] = 3; // alfombra
ground[1 * W + 2] = 2;

function sala2D(overrides: Partial<{ objects: unknown[]; puzzles: unknown[]; lighting: unknown[]; decorations: unknown[]; intro: unknown }> = {}): RoomPackage {
  return parseRoomPackage({
    meta: {
      id: "room-chica",
      title: "Sala chica",
      authorId: "autora",
      version: "1.0.0",
      packageFormat: "roompackage/v1",
      theme: "medieval",
      description: "Sala de prueba del conversor",
      languages: ["es"],
      defaultLanguage: "es",
      estimatedMinutes: 2,
      timeLimitMinutes: 10,
      difficulty: 1,
      players: { min: 1, max: 1 },
      assetsManifest: "r2://assets/packs/medieval-v1/manifest.json",
      ...(overrides.intro ? { intro: overrides.intro } : {}),
    },
    map: {
      tileset: "medieval-v1",
      rooms: [
        {
          id: "sala",
          name: "Sala",
          grid: { cols: W, rows: H },
          layers: [
            { name: "ground", rle: rle(ground) },
            { name: "walls", rle: rle(WALLS.flat()) },
          ],
          decorations: overrides.decorations ?? [],
          spawnPoints: [{ id: "spawn-1", x: 1, y: 2 }],
          lighting: overrides.lighting ?? [{ type: "ambient", color: "#ffffff", intensity: 1 }],
        },
      ],
    },
    objects: overrides.objects ?? [],
    items: [],
    puzzles: overrides.puzzles ?? [],
    rules: [],
    dialogs: [],
    hints: [],
  });
}

const obj = (id: string, x: number, y: number, sprite: string, extra: Record<string, unknown> = {}) => ({
  id,
  roomId: "sala",
  type: "decorativo",
  position: { x, y },
  sprite,
  states: {},
  initialState: "",
  interactable: true,
  ...extra,
});

function options(over: Partial<Convert3DOptions> = {}): Convert3DOptions {
  return {
    sprites: {
      arca: { model: "arca-cerrada", yaw: 0 },
      "arca-der": { model: "arca-cerrada", yaw: 90 },
      "arca-abierta-der": { model: "arca-abierta", yaw: 90 },
      mesa: { model: "mesa", yaw: 0 },
      antorcha: { model: "antorcha", yaw: 0 },
      "cuadro-rey": { model: "cuadro-rey", yaw: 0 },
      mirilla: { model: "mirilla", yaw: 0 },
      "placa-piedra": { model: "placa-arriba", yaw: 0 },
      llave: { model: "llave-bronce-suelo", yaw: 0 },
      "puerta-madera": { model: "puerta-cerrada", yaw: 0 },
      "canal-tramo": { model: "canal-tramo", yaw: 0 },
    },
    hiddenSprites: ["oculto"],
    tiles: MEDIEVAL_V1_TILE_PIECES,
    catalog: getModels3DCatalog("medieval-v1")!,
    meta: { id: "room-chica-3d", title: "Sala chica (3D)" },
    ...over,
  };
}

const convert = (pkg: RoomPackage, over?: Partial<Convert3DOptions>) => convertRoomTo3D(pkg, options(over));
const piecesOf = (pkg: RoomPackage) => pkg.world3d!.rooms["sala"]!.pieces;
const objectOf = (pkg: RoomPackage, id: string) => pkg.objects.find((o) => o.id === id)!;

describe("convertRoomTo3D — meta y habitaciones", () => {
  it("copia la meta con id, título y dimensión 3D; vacía capas y decoraciones; world3d.models = {}", () => {
    const out = convert(sala2D());
    expect(out.meta).toMatchObject({ id: "room-chica-3d", title: "Sala chica (3D)", dimension: "3d", authorId: "autora" });
    expect(out.map.rooms[0]).toMatchObject({ layers: [], decorations: [], grid: { cols: W, rows: H } });
    expect(out.world3d!.models).toEqual({});
  });

  it("no conserva una intro de vídeo; de texto la copia sin narración", () => {
    expect(convert(sala2D({ intro: { type: "video", video: "media:abc" } })).meta.intro).toBeUndefined();
    const text = { type: "text", text: { es: { text: "Hola" } }, audioUrl: "library:1" };
    expect(convert(sala2D({ intro: text })).meta.intro).toEqual({ type: "text", text: { es: { text: "Hola" } } });
  });

  it("no modifica el paquete de entrada", () => {
    const pkg = sala2D({ objects: [obj("a", 1, 3, "arca")] });
    const copia = structuredClone(pkg);
    convert(pkg);
    expect(pkg).toEqual(copia);
  });
});

describe("convertRoomTo3D — suelo y muros", () => {
  const pieces = piecesOf(convert(sala2D()));
  const at = (x: number, y: number) => pieces.filter((p) => p.x === x + 0.5 && p.y === y + 0.5);

  it("suelo por tile en el centro de la celda, con h = 0", () => {
    expect(at(2, 3).map((p) => p.model)).toEqual(["suelo-piedra-1"]);
    expect(at(2, 1).map((p) => p.model)).toEqual(["suelo-piedra-2"]);
    expect(at(1, 1).map((p) => p.model)).toEqual(["suelo-alfombra"]);
    expect(pieces.every((p) => p.h === 0)).toBe(true);
  });

  it("muro en cada celda de muro y sin suelo debajo", () => {
    expect(at(0, 0).map((p) => p.model)).toEqual(["muro"]);
    expect(at(3, 1).map((p) => p.model)).toEqual(["muro"]);
  });

  it("un arco lleva suelo debajo; yaw 0 en muro horizontal y 90 en vertical", () => {
    expect(at(4, 0)).toMatchObject([{ model: "suelo-piedra-1" }, { model: "muro-arco", yaw: 0 }]);
    expect(at(3, 2)).toMatchObject([{ model: "suelo-piedra-1" }, { model: "muro-arco", yaw: 90 }]);
  });

  it("ids deterministas «p-» + contador en base 36 de 8 cifras, sin repetirse", () => {
    expect(pieces[0]!.id).toBe("p-00000000");
    expect(pieces[1]!.id).toBe("p-00000001");
    expect(new Set(pieces.map((p) => p.id)).size).toBe(pieces.length);
    expect(convert(sala2D()).world3d).toEqual(convert(sala2D()).world3d);
  });

  it("un tileId sin pieza falla diciendo cuál", () => {
    expect(() => convert(sala2D(), { tiles: { 1: "suelo-piedra-1", 2: "suelo-piedra-2", 3: "suelo-alfombra" } })).toThrow(/tileId 10/);
  });
});

describe("convertRoomTo3D — objetos", () => {
  it("objeto sin sufijo: centro de la celda, yaw 0; con `-der`: yaw 90 y el sprite pierde el sufijo", () => {
    const out = convert(sala2D({ objects: [obj("a", 1, 3, "arca"), obj("b", 2, 3, "arca-der")] }));
    expect(objectOf(out, "a")).toMatchObject({ sprite: "arca-cerrada", transform: { x: 1.5, y: 3.5, h: 0, yaw: 0 } });
    expect(objectOf(out, "b")).toMatchObject({ sprite: "arca-cerrada", transform: { x: 2.5, y: 3.5, h: 0, yaw: 90 } });
  });

  it("`position` = positionFromTransform(transform) y se quita `footprint`", () => {
    const out = convert(sala2D({ objects: [obj("m", 1, 2, "mesa", { footprint: [{ x: 2, y: 2 }] })] }));
    const m = objectOf(out, "m");
    expect(m.footprint).toBeUndefined();
    expect(m.position).toEqual({ x: Math.round(m.transform!.x), y: Math.round(m.transform!.y) });
  });

  it("objeto con footprint: centro del conjunto de celdas", () => {
    const out = convert(sala2D({ objects: [obj("m", 1, 2, "mesa", { footprint: [{ x: 2, y: 2 }] })] }));
    expect(objectOf(out, "m").transform).toEqual({ x: 2, y: 2.5, h: 0, yaw: 0 });
    const tres = convert(sala2D({ objects: [obj("m", 4, 1, "mesa", { footprint: [{ x: 4, y: 2 }, { x: 4, y: 3 }] })] }));
    expect(objectOf(tres, "m").transform).toEqual({ x: 4.5, y: 2.5, h: 0, yaw: 0 });
  });

  it("objeto sobre un muro: en la cara interior, 1 cm hacia dentro y mirando hacia dentro", () => {
    const out = convert(sala2D({ objects: [obj("c", 1, 0, "cuadro-rey", { type: "escondite" })] }));
    expect(objectOf(out, "c").transform).toEqual({ x: 1.5, y: 1.01, h: 0, yaw: 0 });
    // muro del este: la cara interior mira a −x
    const este = convert(sala2D({ objects: [obj("c", 6, 2, "cuadro-rey")] }));
    expect(objectOf(este, "c").transform).toEqual({ x: 5.99, y: 2.5, h: 0, yaw: 270 });
  });

  it("dos objetos en la misma celda de muro: 2 cm de separación por cada uno ya colocado", () => {
    const out = convert(sala2D({ objects: [obj("a", 1, 0, "cuadro-rey"), obj("b", 1, 0, "cuadro-rey"), obj("c", 1, 0, "cuadro-rey")] }));
    expect(["a", "b", "c"].map((id) => objectOf(out, id).transform!.y)).toEqual([1.01, 1.03, 1.05]);
  });

  it("una puerta (`leadsTo`) va al centro de su celda, con el giro de su cara interior", () => {
    const out = convert(sala2D({ objects: [obj("p", 4, 0, "puerta-madera", { type: "puerta", leadsTo: "otra" })] }));
    expect(objectOf(out, "p").transform).toEqual({ x: 4.5, y: 0.5, h: 0, yaw: 0 });
  });

  it("una celda de muro sin ninguna celda libre alrededor falla (no tiene cara interior)", () => {
    expect(() => convert(sala2D({ objects: [obj("p", 0, 0, "puerta-madera", { type: "puerta" })] }))).toThrow(/cara interior/);
  });

  it("estados: se sustituye cada sprite, `oculto` se deja y se conserva la animación", () => {
    const out = convert(
      sala2D({
        objects: [
          obj("l", 2, 3, "llave", {
            states: { oculto: "oculto", visible: "llave", abierta: { sprite: "arca-abierta-der", animation: "abrir" }, solo: { animation: "abrir" } },
            initialState: "oculto",
          }),
        ],
      }),
    );
    expect(objectOf(out, "l").states).toEqual({
      oculto: "oculto",
      visible: "llave-bronce-suelo",
      abierta: { sprite: "arca-abierta", animation: "abrir" },
      solo: { animation: "abrir" },
    });
  });

  it("un sprite sin modelo falla con el id del objeto", () => {
    expect(() => convert(sala2D({ objects: [obj("raro", 1, 3, "desconocido")] }))).toThrow(/raro/);
  });
});

describe("convertRoomTo3D — decoraciones, aparición, luces y puzles", () => {
  it("decoración → pieza en el centro de su celda", () => {
    const out = convert(sala2D({ decorations: [{ sprite: "canal-tramo", x: 2, y: 3 }] }));
    expect(piecesOf(out).at(-1)).toMatchObject({ model: "canal-tramo", x: 2.5, y: 3.5, h: 0, yaw: 0 });
  });

  it("puntos de aparición al centro de la celda, h = 0 y yaw = 0", () => {
    expect(convert(sala2D()).map.rooms[0]!.spawnPoints[0]).toEqual({ id: "spawn-1", x: 1.5, y: 2.5, h: 0, yaw: 0 });
  });

  it("antorcha en un muro → cara interior; en el suelo → centro; h = 1,6; la ambiental no cambia", () => {
    const out = convert(
      sala2D({
        lighting: [
          { type: "torch", x: 1, y: 0 },
          { type: "torch", x: 2, y: 3, objectId: "brasero" },
          { type: "ambient", color: "#ffffff", intensity: 1 },
        ],
      }),
    );
    expect(out.map.rooms[0]!.lighting).toEqual([
      { type: "torch", x: 1.5, y: 1, h: 1.6 },
      { type: "torch", x: 2.5, y: 3.5, h: 1.6, objectId: "brasero" },
      { type: "ambient", color: "#ffffff", intensity: 1 },
    ]);
  });

  it("placas: +0,5 en x e y; split_clue y el resto de puzles no cambian", () => {
    const splitClue = {
      id: "p-mirillas",
      type: "split_clue",
      layer: "world",
      roomId: "sala",
      requiresSolved: [],
      grantsItems: [],
      unlocks: [],
      viewpoints: [{ objectId: "mirilla", zone: { x: 1, y: 1, w: 2, h: 2 } }],
      fragments: ["a"],
      visibleByViewpoint: { mirilla: ["a"] },
      wallOccluder: { x: 3, y: 1, w: 0, h: 2 },
      inputUI: "symbols",
    };
    const plates = {
      id: "p-placas",
      type: "simultaneous_plates",
      layer: "world",
      roomId: "sala",
      requiresSolved: [],
      grantsItems: [],
      unlocks: [],
      plates: [{ objectId: "placa-a", x: 1, y: 3 }, { objectId: "placa-b", x: 5, y: 3 }],
      windowMs: 800,
      holdMode: "stand",
    };
    const hidden = {
      id: "p-llave",
      type: "hidden_key",
      layer: "world",
      roomId: "sala",
      position: { x: 1, y: 3 },
      requiresSolved: [],
      grantsItems: [],
      unlocks: [],
      hidingSpot: { x: 2, y: 3 },
      revealAnimation: "fade",
    };
    const out = convert(sala2D({ puzzles: [splitClue, plates, hidden] }));
    expect(out.puzzles[0]).toEqual(sala2D({ puzzles: [splitClue] }).puzzles[0]);
    expect(out.puzzles[1]).toMatchObject({ plates: [{ objectId: "placa-a", x: 1.5, y: 3.5 }, { objectId: "placa-b", x: 5.5, y: 3.5 }] });
    expect(out.puzzles[2]).toMatchObject({ position: { x: 1, y: 3 }, hidingSpot: { x: 2.5, y: 3.5 } });
  });
});

describe("convertRoomTo3D — resultado válido", () => {
  it("la sala convertida pasa el esquema y el validador sin errores", () => {
    const out = convert(
      sala2D({
        objects: [
          obj("a", 1, 3, "arca-der"),
          obj("c", 1, 0, "cuadro-rey"),
          obj("l", 2, 3, "llave", { states: { oculto: "oculto", visible: "llave" }, initialState: "oculto" }),
        ],
      }),
    );
    expect(parseRoomPackage(JSON.parse(JSON.stringify(out)))).toEqual(out);
    const report = validateRoomPackage(out);
    // La sala de prueba no tiene reglas de victoria: solo se exige que no falle nada más.
    expect(report.checks.filter((c) => c.status === "error" && c.id !== "solvability")).toEqual([]);
    expect(report.checks.find((c) => c.id === "world3d")!.issues).toEqual([]);
    expect(report.checks.find((c) => c.id === "world3d_models")!.issues).toEqual([]);
  });
});
